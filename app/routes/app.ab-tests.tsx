import { useEffect, useState } from 'react';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import {
	Page,
	Layout,
	Text,
	Card,
	Button,
	BlockStack,
	Banner,
	DataTable,
	Badge,
	Modal,
	FormLayout,
	TextField,
	InlineStack,
} from '@shopify/polaris';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';
import { RotationTrigger, RotationVariant } from '@prisma/client';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { calculateStatistics } from '../features/ab-testing/utils/statistics';
import { executeRotationSwap } from '../services/ab-test-rotation-sync.server';
import { recordRotationHistory, updateRotationSlot } from '../services/ab-test-rotation.store';

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const { session } = await authenticate.admin(request);

	const abTests = await db.aBTest.findMany({
		where: { shop: session.shop },
		include: {
			variants: true,
			events: {
				orderBy: { createdAt: 'asc' },
			},
			rotationSlots: {
				include: {
					history: {
						orderBy: { switchedAt: 'desc' },
						take: 5,
					},
					variantA: true,
					variantB: true,
				},
			},
		},
		orderBy: { createdAt: 'desc' },
	});

	const serialized = abTests.map(test => ({
		...test,
		events: test.events.map(event => ({
			...event,
			createdAt: event.createdAt.toISOString(),
		})),
		rotationSlots: test.rotationSlots.map(slot => ({
			...slot,
			lastSwitchAt: slot.lastSwitchAt?.toISOString() ?? null,
			nextSwitchDueAt: slot.nextSwitchDueAt?.toISOString() ?? null,
			history: slot.history.map(entry => ({
				...entry,
				switchedAt: entry.switchedAt.toISOString(),
			})),
		})),
	}));

	return json({ abTests: serialized });
};

export const action = async ({ request }: ActionFunctionArgs) => {
	try {
		const { session } = await authenticate.admin(request);
		const formData = await request.formData();
		const intent = String(formData.get('intent') || '');

		if (intent === 'create') {
			const name = String(formData.get('name') || '');
			const productId = String(formData.get('productId') || '');
			const variantScope = String(formData.get('variantScope') || 'PRODUCT');
			const variantTestsJson = String(formData.get('variantTests') || '');
			const variantAImages = String(formData.get('variantAImages') || '');
			const variantBImages = String(formData.get('variantBImages') || '');

			if (!name || !productId) {
				return json({ ok: false, error: 'Missing required fields' }, { status: 400 });
			}

			// Parse variant tests if scope is VARIANT
			let variantTests: Array<{ shopifyVariantId: string; variantAImages: string; variantBImages: string }> = [];
			if (variantScope === 'VARIANT' && variantTestsJson) {
				try {
					variantTests = JSON.parse(variantTestsJson);
					if (!Array.isArray(variantTests) || variantTests.length === 0) {
						return json({ ok: false, error: 'Variant tests must be a non-empty array' }, { status: 400 });
					}
				} catch (error) {
					return json({ ok: false, error: 'Invalid variant tests format' }, { status: 400 });
				}
			} else if (variantScope === 'PRODUCT' && (!variantAImages || !variantBImages)) {
				return json({ ok: false, error: 'Missing variant images for product-wide test' }, { status: 400 });
			}

			// Check for existing active test for this product
			const existingActiveTest = await db.aBTest.findFirst({
				where: {
					shop: session.shop,
					productId,
					status: {
						in: ['DRAFT', 'RUNNING'],
					},
				},
			});

			if (existingActiveTest) {
				return json(
					{
						ok: false,
						error: 'An active A/B test already exists for this product. Please complete or delete the existing test before creating a new one.',
					},
					{ status: 400 },
				);
			}

			try {
				let test;

				if (variantScope === 'VARIANT') {
					// Create SINGLE test with multiple variant configurations
					// Each Shopify variant gets both A and B test variants
					const variantConfigs = variantTests.flatMap(vt => [
						{
							variant: 'A',
							imageUrls: JSON.stringify(vt.variantAImages),
							shopifyVariantId: vt.shopifyVariantId,
						},
						{
							variant: 'B',
							imageUrls: JSON.stringify(vt.variantBImages),
							shopifyVariantId: vt.shopifyVariantId,
						},
					]);

					test = await db.aBTest.create({
						data: {
							shop: session.shop,
							productId,
							name,
							status: 'DRAFT',
							variantScope: 'VARIANT',
							trafficSplit: 50,
							variants: {
								create: variantConfigs,
							},
						},
						include: {
							variants: true,
						},
					});

					console.log(
						`[A/B Test Created] Single test with ${variantConfigs.length} variant configs (${variantTests.length} Shopify variants x 2)`,
					);
				} else {
					// Create product-wide test
					test = await db.aBTest.create({
						data: {
							shop: session.shop,
							productId,
							name,
							status: 'DRAFT',
							variantScope: 'PRODUCT',
							trafficSplit: 50,
							variants: {
								create: [
									{
										variant: 'A',
										imageUrls: variantAImages,
										shopifyVariantId: null,
									},
									{
										variant: 'B',
										imageUrls: variantBImages,
										shopifyVariantId: null,
									},
								],
							},
						},
						include: {
							variants: true,
						},
					});

					console.log(`[A/B Test Created] Product-wide test with 2 variants (A/B)`);
				}

				return json({ ok: true, test });
			} catch (error) {
				console.error('Failed to create A/B test:', error);
				return json({ ok: false, error: 'Failed to create A/B test' }, { status: 500 });
			}
		}

		if (intent === 'start') {
			const testId = String(formData.get('testId') || '');

			// Check if test belongs to this shop
			const test = await db.aBTest.findFirst({
				where: {
					id: testId,
					shop: session.shop,
				},
			});

			if (!test) {
				return json({ ok: false, error: 'Test not found' }, { status: 404 });
			}

			// Check for other active tests on the same product
			const otherActiveTest = await db.aBTest.findFirst({
				where: {
					shop: session.shop,
					productId: test.productId,
					id: { not: testId },
					status: 'RUNNING',
				},
			});

			if (otherActiveTest) {
				return json(
					{
						ok: false,
						error: 'Another test is already running for this product. Please stop it first.',
					},
					{ status: 400 },
				);
			}

			try {
				const updatedTest = await db.aBTest.update({
					where: { id: testId },
					data: {
						status: 'RUNNING',
						startDate: new Date(),
					},
				});

				return json({ ok: true, test: updatedTest });
			} catch (error) {
				return json({ ok: false, error: 'Failed to start test' }, { status: 500 });
			}
		}

		if (intent === 'stop') {
			const testId = String(formData.get('testId') || '');

			try {
				const test = await db.aBTest.update({
					where: { id: testId },
					data: {
						status: 'COMPLETED',
						endDate: new Date(),
					},
				});

				return json({ ok: true, test });
			} catch (error) {
				return json({ ok: false, error: 'Failed to stop test' }, { status: 500 });
			}
		}

		if (intent === 'delete') {
			const testId = String(formData.get('testId') || '');

			try {
				await db.aBTestEvent.deleteMany({
					where: { testId },
				});

				await db.aBTestVariant.deleteMany({
					where: { testId },
				});

				await db.aBTest.delete({
					where: { id: testId },
				});

				return json({ ok: true });
			} catch (error) {
				return json({ ok: false, error: 'Failed to delete test' }, { status: 500 });
			}
		}

		return json({ ok: false, error: 'Unknown intent' }, { status: 400 });
	} catch (error) {
		console.error('Action error:', error);
		return json(
			{
				ok: false,
				error: error instanceof Error ? error.message : 'Internal server error',
			},
			{ status: 500 },
		);
	}

	if (intent === 'rotation:switch') {
		const slotId = String(formData.get('slotId') || '');
		const targetVariantRaw = String(formData.get('targetVariant') || '');

		if (!slotId || !targetVariantRaw) {
			return json({ ok: false, error: 'Missing rotation parameters' }, { status: 400 });
		}

		if (targetVariantRaw !== 'CONTROL' && targetVariantRaw !== 'TEST') {
			return json({ ok: false, error: 'Invalid rotation target' }, { status: 400 });
		}

		const slot = await db.rotationSlot.findFirst({
			where: {
				id: slotId,
				shop: session.shop,
			},
			include: {
				test: true,
				variantA: true,
				variantB: true,
			},
		});

		if (!slot) {
			return json({ ok: false, error: 'Rotation slot not found' }, { status: 404 });
		}

		const targetVariant = targetVariantRaw as RotationVariant;
		const result = await executeRotationSwap({
			slot,
			currentVariant: slot.activeVariant,
			targetVariant,
		});

		if (result.outcome === 'failure') {
			return json({ ok: false, error: result.message }, { status: 400 });
		}

		const now = new Date();
		await updateRotationSlot(slot.id, {
			activeVariant: targetVariant,
			lastSwitchAt: now,
			nextSwitchDueAt: addMinutes(now, slot.intervalMinutes),
		});

		await recordRotationHistory({
			slotId: slot.id,
			switchedVariant: targetVariant,
			triggeredBy: RotationTrigger.MANUAL,
			switchedAt: now,
			context: result.context ?? null,
		});

		return json({ ok: true });
	}
};

export default function ABTests() {
	const { abTests } = useLoaderData<typeof loader>();
	const fetcher = useFetcher<typeof action>();
	const shopify = useAppBridge();

	const [showCreateModal, setShowCreateModal] = useState(false);
	const [newTestName, setNewTestName] = useState('');
	const [selectedProductId, setSelectedProductId] = useState('');
	const [variantAImages, setVariantAImages] = useState('');
	const [variantBImages, setVariantBImages] = useState('');
	const [rotationModal, setRotationModal] = useState<
		{ testId: string; testName: string; slots: Array<any> } | null
	>(null);

	useEffect(() => {
		const data = fetcher.data;
		if (data?.ok && fetcher.formData?.get('intent') === 'create') {
			setShowCreateModal(false);
			setNewTestName('');
			setSelectedProductId('');
			setVariantAImages('');
			setVariantBImages('');
			shopify.toast.show('A/B test created successfully');
		} else if (data?.ok && fetcher.formData?.get('intent') === 'start') {
			shopify.toast.show('A/B test started');
		} else if (data?.ok && fetcher.formData?.get('intent') === 'stop') {
			shopify.toast.show('A/B test stopped');
		} else if (data?.ok && fetcher.formData?.get('intent') === 'delete') {
			shopify.toast.show('A/B test deleted');
	} else if (data?.ok && fetcher.formData?.get('intent') === 'rotation:switch') {
		shopify.toast.show('Rotation slot updated');
		setRotationModal(null);
		} else if (data && !data.ok) {
			shopify.toast.show((data as any).error, { isError: true });
		}
	}, [fetcher.data]);

	const getStatusBadge = (status: string) => {
		switch (status) {
			case 'DRAFT':
				return <Badge tone='attention'>Draft</Badge>;
			case 'RUNNING':
				return <Badge tone='success'>Running</Badge>;
			case 'PAUSED':
				return <Badge tone='warning'>Paused</Badge>;
			case 'COMPLETED':
				return <Badge tone='info'>Completed</Badge>;
			case 'ARCHIVED':
				return <Badge>Archived</Badge>;
			default:
				return <Badge>{status}</Badge>;
		}
	};

	const openRotationManager = (test: (typeof abTests)[number]) => {
		setRotationModal({
			testId: test.id,
			testName: test.name,
			slots: test.rotationSlots ?? [],
		});
	};

	const formatRotationCell = (test: (typeof abTests)[number]) => {
		if (!test.rotationSlots || test.rotationSlots.length === 0) {
			return (
				<Button size='micro' onClick={() => openRotationManager(test)}>
					Configure
				</Button>
			);
		}

		const activeSlot =
			test.rotationSlots.find((slot: any) => slot.status === 'ACTIVE') || test.rotationSlots[0];

		return (
			<BlockStack gap='100'>
				<InlineStack align='space-between'>
					<Text variant='bodySm'>
						{activeSlot.shopifyVariantId ? 'Variant rotation' : 'Product rotation'}
					</Text>
					<Badge tone={activeSlot.activeVariant === 'CONTROL' ? 'info' : 'success'}>
						{activeSlot.activeVariant}
					</Badge>
				</InlineStack>
				<Text variant='bodySm' tone='subdued'>
					Next switch: {formatTimestamp(activeSlot.nextSwitchDueAt)}
				</Text>
				<Button size='micro' onClick={() => openRotationManager(test)}>
					Manage
				</Button>
			</BlockStack>
		);
	};

	const formatTimestamp = (value: string | null) => {
		if (!value) return 'Not scheduled';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'Unknown';
		return date.toLocaleString();
	};

	const formatScopeLabel = (slot: any) => {
		if (!slot.shopifyVariantId) {
			return 'Product scope';
		}
		const raw = String(slot.shopifyVariantId);
		const readable = raw.split('/').pop();
		return `Variant ${readable}`;
	};

	const submitRotationSwitch = (slotId: string, target: RotationVariant) => {
		const fd = new FormData();
		fd.set('intent', 'rotation:switch');
		fd.set('slotId', slotId);
		fd.set('targetVariant', target);
		fetcher.submit(fd, { method: 'post' });
	};

	const renderRotationSlot = (slot: any) => (
		<Card key={slot.id}>
			<BlockStack gap='200'>
				<InlineStack align='space-between'>
					<Text variant='headingSm'>{formatScopeLabel(slot)}</Text>
					<Badge tone={slot.status === 'ACTIVE' ? 'success' : 'attention'}>{slot.status}</Badge>
				</InlineStack>
				<Text variant='bodySm'>Active variant: {slot.activeVariant}</Text>
				<Text variant='bodySm'>Interval: {slot.intervalMinutes} minutes</Text>
				<Text variant='bodySm' tone='subdued'>Last switch: {formatTimestamp(slot.lastSwitchAt)}</Text>
				<Text variant='bodySm' tone='subdued'>Next switch: {formatTimestamp(slot.nextSwitchDueAt)}</Text>
				<InlineStack gap='200'>
					<Button
						size='micro'
						onClick={() => submitRotationSwitch(slot.id, RotationVariant.CONTROL)}
						disabled={slot.activeVariant === RotationVariant.CONTROL}
					>
						Activate Control
					</Button>
					<Button
						size='micro'
						onClick={() => submitRotationSwitch(slot.id, RotationVariant.TEST)}
						disabled={slot.activeVariant === RotationVariant.TEST}
					>
						Activate Test
					</Button>
				</InlineStack>
				<BlockStack gap='100'>
					<Text variant='bodySm'>Recent switches</Text>
					{slot.history && slot.history.length > 0 ? (
						slot.history.map((entry: any) => (
							<InlineStack key={entry.id} align='space-between'>
								<Text variant='bodySm'>{entry.switchedVariant}</Text>
								<Text variant='bodySm' tone='subdued'>{formatTimestamp(entry.switchedAt)}</Text>
							</InlineStack>
						))
					) : (
						<Text variant='bodySm' tone='subdued'>No recent history</Text>
					)}
				</BlockStack>
			</BlockStack>
		</Card>
	);

	const rows = abTests.map(test => {
		const stats = calculateStatistics(test.events);
		return [
			test.name,
			test.productId,
			getStatusBadge(test.status),
			formatRotationCell(test),
			`${stats.variantA.impressions.toLocaleString()} / ${stats.variantA.addToCarts.toLocaleString()} / ${stats.variantA.purchases.toLocaleString()} / ${stats.variantA.ratePercent}% / $${stats.variantA.revenue.toFixed(2)}`,
			`${stats.variantB.impressions.toLocaleString()} / ${stats.variantB.addToCarts.toLocaleString()} / ${stats.variantB.purchases.toLocaleString()} / ${stats.variantB.ratePercent}% / $${stats.variantB.revenue.toFixed(2)}`,
			<InlineStack key={test.id} gap='200'>
				{test.status === 'DRAFT' && (
					<Button
						size='micro'
						onClick={() => {
							const fd = new FormData();
							fd.set('intent', 'start');
							fd.set('testId', test.id);
							fetcher.submit(fd, { method: 'post' });
						}}
					>
						Start
					</Button>
				)}
				{test.status === 'RUNNING' && (
					<Button
						size='micro'
						onClick={() => {
							const fd = new FormData();
							fd.set('intent', 'stop');
							fd.set('testId', test.id);
							fetcher.submit(fd, { method: 'post' });
						}}
					>
						Stop
					</Button>
				)}
				<Button
					size='micro'
					tone='critical'
					onClick={() => {
						if (confirm('Are you sure you want to delete this test?')) {
							const fd = new FormData();
							fd.set('intent', 'delete');
							fd.set('testId', test.id);
							fetcher.submit(fd, { method: 'post' });
						}
					}}
				>
					Delete
				</Button>
			</InlineStack>,
		];
	});

	return (
		<Page>
			<TitleBar title='A/B Tests' />

			<Layout>
				<Layout.Section>
					<BlockStack gap='500'>
						<Card>
							<BlockStack gap='300'>
								<InlineStack align='space-between'>
									<Text as='h2' variant='headingMd'>
										A/B Tests
									</Text>
									<Button variant='primary' onClick={() => setShowCreateModal(true)}>
										Create Test
									</Button>
								</InlineStack>

								{abTests.length === 0 ? (
									<Banner>
										<Text as='p'>
											No A/B tests created yet. Create your first test to start comparing image
											variants.
										</Text>
									</Banner>
								) : (
				<DataTable
					columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text']}
					headings={[
						'Name',
						'Product ID',
						'Status',
						'Rotation',
						'Variant A (Views/CVR)',
						'Variant B (Views/CVR)',
						'Actions',
					]}
					rows={rows}
				/>
								)}
							</BlockStack>
						</Card>
					</BlockStack>
				</Layout.Section>
			</Layout>

			<Modal
				open={showCreateModal}
				onClose={() => setShowCreateModal(false)}
				title='Create A/B Test'
				primaryAction={{
					content: 'Create Test',
					onAction: () => {
						const fd = new FormData();
						fd.set('intent', 'create');
						fd.set('name', newTestName);
						fd.set('productId', selectedProductId);
						fd.set('variantAImages', variantAImages);
						fd.set('variantBImages', variantBImages);
						fetcher.submit(fd, { method: 'post' });
					},
					disabled:
						!newTestName ||
						!selectedProductId ||
						!variantAImages ||
						!variantBImages ||
						fetcher.state === 'submitting',
					loading: fetcher.state === 'submitting',
				}}
				secondaryActions={[
					{
						content: 'Cancel',
						onAction: () => setShowCreateModal(false),
					},
				]}
			>
				<Modal.Section>
					<FormLayout>
						<TextField
							label='Test Name'
							value={newTestName}
							onChange={setNewTestName}
							placeholder='e.g., Homepage Hero Test'
							autoComplete='off'
						/>
						<TextField
							label='Product ID'
							value={selectedProductId}
							onChange={setSelectedProductId}
							placeholder='gid://shopify/Product/123456789'
							autoComplete='off'
						/>
						<TextField
							label='Variant A Image URLs (JSON array)'
							value={variantAImages}
							onChange={setVariantAImages}
							placeholder='["https://cdn.shopify.com/image1.jpg"]'
							multiline={3}
							autoComplete='off'
						/>
						<TextField
							label='Variant B Image URLs (JSON array)'
							value={variantBImages}
							onChange={setVariantBImages}
							placeholder='["https://cdn.shopify.com/image2.jpg"]'
							multiline={3}
							autoComplete='off'
						/>
					</FormLayout>
				</Modal.Section>
			</Modal>

			<Modal
				open={rotationModal !== null}
				onClose={() => setRotationModal(null)}
				title={rotationModal ? `Rotation Slots — ${rotationModal.testName}` : 'Rotation Slots'}
				size='large'
			>
				<Modal.Section>
					{rotationModal && rotationModal.slots.length > 0 ? (
						<BlockStack gap='300'>
							{rotationModal.slots.map((slot: any) => renderRotationSlot(slot))}
						</BlockStack>
					) : (
						<Banner status='info'>
							<Text variant='bodyMd'>No rotation slots configured for this test yet.</Text>
						</Banner>
					)}
				</Modal.Section>
			</Modal>
		</Page>
	);
}

function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60_000);
}
