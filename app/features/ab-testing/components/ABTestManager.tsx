import { useState, useCallback } from 'react';
import { Card, Text, Button, BlockStack, InlineStack, Banner, EmptyState, Badge } from '@shopify/polaris';
import { ABTestCreator } from './ABTestCreator';
import type { ABTestCreateRequest, SerializedABTest } from '../types';
import { calculateStatistics } from '../utils/statistics';

interface ABTestManagerProps {
	productId: string;
	availableImages: string[];
	variants?: any[];
	existingTests?: SerializedABTest[];
	activeTest?: SerializedABTest | null;
	onTestCreate: (request: ABTestCreateRequest) => Promise<void>;
	onTestAction?: (testId: string, action: 'start' | 'stop' | 'delete') => void;
	isCreating?: boolean;
}

export function ABTestManager({
	productId,
	availableImages,
	variants,
	existingTests = [],
	activeTest = null,
	onTestCreate,
	onTestAction,
	isCreating = false,
}: ABTestManagerProps) {
	const [showCreator, setShowCreator] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleCreateTest = useCallback(
		async (request: ABTestCreateRequest) => {
			setIsSubmitting(true);
			try {
				await onTestCreate(request);
				setShowCreator(false);
			} catch (error) {
				console.error('Failed to create A/B test:', error);
			} finally {
				setIsSubmitting(false);
			}
		},
		[onTestCreate],
	);

	if (availableImages.length === 0) {
		return (
			<Card>
				<EmptyState
					heading='No images available'
					image='https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png'
				>
					<Text as='p'>
						You need at least 2 images to create an A/B test. Generate some AI images or add product images
						first.
					</Text>
				</EmptyState>
			</Card>
		);
	}

	if (availableImages.length < 2) {
		return (
			<Card>
				<Banner tone='warning'>
					<Text as='p'>
						You need at least 2 images to create an A/B test. You currently have {availableImages.length}{' '}
						image(s) available.
					</Text>
				</Banner>
			</Card>
		);
	}

	const getSummaryStats = () => {
		const runningTests = existingTests.filter(test => test.status === 'RUNNING').length;
		const totalImpressions = existingTests.length;
		const avgLift =
			existingTests.reduce((sum, test) => sum + (Number(test.stats?.lift) ?? 0), 0) / existingTests.length;

		return { totalTests: existingTests.length, runningTests, totalImpressions, avgLift };
	};

	const formatVariantTitle = (variant: any): string => {
		if (!variant) return 'Unknown';
		if (variant.title === 'Default Title') {
			return 'Default Variant';
		}
		const options = variant.selectedOptions?.map((opt: any) => opt.value).join(' / ');
		return options || variant.title || 'Unknown';
	};

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

	const parseImageUrls = (imageUrls: any): string[] => {
		try {
			if (!imageUrls) return [];
			if (Array.isArray(imageUrls)) return imageUrls;
			return JSON.parse(imageUrls as unknown as string);
		} catch {
			return [];
		}
	};

	return (
		<BlockStack gap='500'>
			{/* Compact Header */}
			<Card>
				<InlineStack align='space-between' wrap={false}>
					<BlockStack gap='100'>
						<Text as='h2' variant='headingLg'>
							A/B Testing
						</Text>
						<Text as='p' variant='bodyMd' tone='subdued'>
							Optimize your product images with A/B tests
						</Text>
					</BlockStack>
					<InlineStack gap='200'>
						{activeTest && !showCreator && (
							<Text as='span' variant='bodySm' tone='success' fontWeight='semibold'>
								Active test running
							</Text>
						)}
						{showCreator && (
							<Button variant='tertiary' onClick={() => setShowCreator(false)} disabled={isSubmitting}>
								Cancel
							</Button>
						)}
						{!showCreator && !activeTest && (
							<Button
								variant='primary'
								onClick={() => setShowCreator(true)}
								disabled={availableImages.length < 2}
							>
								Create Test
							</Button>
						)}
					</InlineStack>
				</InlineStack>
			</Card>

			{/* A/B Test Creator - only show if no active test */}
			{showCreator && !activeTest && (
				<ABTestCreator
					productId={productId}
					availableImages={availableImages}
					variants={variants}
					onTestCreate={handleCreateTest}
					isCreating={isSubmitting}
				/>
			)}

			{/* Compressed Overview & Tests Table */}
			{existingTests.length > 0 && (
				<Card>
					<BlockStack gap='400'>
						{/* Compact Header with Key Stats */}
						<InlineStack align='space-between' wrap={false}>
							<BlockStack gap='100'>
								<Text as='h3' variant='headingMd'>
									A/B Test Results
								</Text>
							</BlockStack>
						</InlineStack>

						{/* Tests Table */}
						<BlockStack gap='300'>
							{existingTests.map(test => {
								const stats = calculateStatistics(test.events || []);

								// Check if this is a variant-scoped test
								const isVariantScoped = test.variantScope === 'VARIANT';

								if (isVariantScoped) {
									// Group variants by shopifyVariantId
									const variantGroups = new Map<string, { variantA: any; variantB: any }>();
									test.variants.forEach((v: any) => {
										const key = v.shopifyVariantId || 'null';
										if (!variantGroups.has(key)) {
											variantGroups.set(key, { variantA: null, variantB: null });
										}
										const group = variantGroups.get(key)!;
										if (v.variant === 'A') {
											group.variantA = v;
										} else if (v.variant === 'B') {
											group.variantB = v;
										}
									});

									// Find matching Shopify variants from props
									const getShopifyVariant = (shopifyVariantId: string | null) => {
										if (!shopifyVariantId || !variants) return null;
										return variants.find((v: any) => v.id === shopifyVariantId) || null;
									};

									return (
										<Card key={test.id}>
											<BlockStack gap='300'>
												{/* Test Header */}
												<InlineStack align='space-between' wrap={false}>
													<InlineStack gap='200' align='center'>
														<Text as='h4' variant='headingSm'>
															{test.name}
														</Text>
														{getStatusBadge(test.status)}
														<Badge tone='info'>Variant-Scoped</Badge>
													</InlineStack>
													<InlineStack gap='200'>
														{test.status === 'DRAFT' && (
															<Button
																size='slim'
																variant='primary'
																onClick={() => onTestAction?.(test.id, 'start')}
															>
																Start
															</Button>
														)}
														{test.status === 'RUNNING' && (
															<Button
																size='slim'
																tone='critical'
																onClick={() => onTestAction?.(test.id, 'stop')}
															>
																Stop
															</Button>
														)}
														<Button
															size='slim'
															variant='tertiary'
															tone='critical'
															onClick={() => onTestAction?.(test.id, 'delete')}
														>
															Delete
														</Button>
													</InlineStack>
												</InlineStack>

												{/* Variant Groups */}
												<BlockStack gap='400'>
													{Array.from(variantGroups.entries()).map(
														([shopifyVariantId, group]) => {
															const shopifyVariant = getShopifyVariant(shopifyVariantId);
															const variantTitle = shopifyVariant
																? formatVariantTitle(shopifyVariant)
																: shopifyVariantId === 'null'
																	? 'Product-Wide'
																	: `Variant ${shopifyVariantId.substring(0, 8)}...`;

															const variantAImages = parseImageUrls(
																group.variantA?.imageUrls,
															);
															const variantBImages = parseImageUrls(
																group.variantB?.imageUrls,
															);

															// Filter stats for this specific variant if available
															const variantStats = {
																variantA: {
																	impressions: stats.variantA.impressions,
																	conversions: stats.variantA.conversions,
																},
																variantB: {
																	impressions: stats.variantB.impressions,
																	conversions: stats.variantB.conversions,
																},
															};

															return (
																<Card key={shopifyVariantId} background='subdued'>
																	<BlockStack gap='300'>
																		<Text
																			as='h5'
																			variant='headingSm'
																			fontWeight='semibold'
																		>
																			{variantTitle}
																		</Text>

																		{/* Variants Comparison Table */}
																		<div
																			style={{
																				display: 'grid',
																				gridTemplateColumns:
																					'auto auto auto auto',
																				gap: '12px',
																				alignItems: 'center',
																			}}
																		>
																			{/* Header Row */}
																			<div />
																			<Text
																				as='span'
																				variant='bodyMd'
																				fontWeight='semibold'
																			>
																				Images
																			</Text>
																			<Text
																				as='span'
																				variant='bodyMd'
																				fontWeight='semibold'
																			>
																				Impressions
																			</Text>
																			<Text
																				as='span'
																				variant='bodyMd'
																				fontWeight='semibold'
																			>
																				ATC
																			</Text>

																			{/* Variant A Row */}
																			<Text
																				as='span'
																				variant='bodyMd'
																				fontWeight='semibold'
																			>
																				A{' '}
																				{stats.winner === 'A' &&
																					stats.isSignificant &&
																					'🏆'}
																			</Text>
																			<InlineStack gap='100' wrap={false}>
																				{variantAImages
																					.slice(0, 3)
																					.map(
																						(
																							url: string,
																							index: number,
																						) => (
																							<div
																								key={index}
																								style={{
																									width: '84px',
																									height: '84px',
																									borderRadius: '4px',
																									overflow: 'hidden',
																									border: '1px solid #E1E3E5',
																									flexShrink: 0,
																								}}
																							>
																								<img
																									src={url}
																									alt={`A${index + 1}`}
																									style={{
																										maxWidth:
																											'100%',
																										maxHeight:
																											'100%',
																										width: 'auto',
																										height: 'auto',
																										objectFit:
																											'contain',
																										display:
																											'block',
																										margin: '0 auto',
																									}}
																								/>
																							</div>
																						),
																					)}
																				{variantAImages.length > 3 && (
																					<Text
																						as='span'
																						variant='bodySm'
																						tone='subdued'
																					>
																						+{variantAImages.length - 3}
																					</Text>
																				)}
																				{variantAImages.length === 0 && (
																					<Text
																						as='span'
																						variant='bodySm'
																						tone='subdued'
																					>
																						No images
																					</Text>
																				)}
																			</InlineStack>
																			<Text as='span' variant='bodySm'>
																				{variantStats.variantA.impressions.toLocaleString()}
																			</Text>
																			<Text as='span' variant='bodySm'>
																				{variantStats.variantA.conversions.toLocaleString()}
																			</Text>

																			{/* Variant B Row */}
																			<Text
																				as='span'
																				variant='bodyMd'
																				fontWeight='semibold'
																			>
																				B{' '}
																				{stats.winner === 'B' &&
																					stats.isSignificant &&
																					'🏆'}
																			</Text>
																			<InlineStack gap='100' wrap={false}>
																				{variantBImages
																					.slice(0, 3)
																					.map(
																						(
																							url: string,
																							index: number,
																						) => (
																							<div
																								key={index}
																								style={{
																									width: '84px',
																									height: '84px',
																									borderRadius: '4px',
																									overflow: 'hidden',
																									border: '1px solid #E1E3E5',
																									flexShrink: 0,
																								}}
																							>
																								<img
																									src={url}
																									alt={`B${index + 1}`}
																									style={{
																										maxWidth:
																											'100%',
																										maxHeight:
																											'100%',
																										width: 'auto',
																										height: 'auto',
																										objectFit:
																											'contain',
																										display:
																											'block',
																										margin: '0 auto',
																									}}
																								/>
																							</div>
																						),
																					)}
																				{variantBImages.length > 3 && (
																					<Text
																						as='span'
																						variant='bodySm'
																						tone='subdued'
																					>
																						+{variantBImages.length - 3}
																					</Text>
																				)}
																				{variantBImages.length === 0 && (
																					<Text
																						as='span'
																						variant='bodySm'
																						tone='subdued'
																					>
																						No images
																					</Text>
																				)}
																			</InlineStack>
																			<Text as='span' variant='bodySm'>
																				{variantStats.variantB.impressions.toLocaleString()}
																			</Text>
																			<Text as='span' variant='bodySm'>
																				{variantStats.variantB.conversions.toLocaleString()}
																			</Text>
																		</div>
																	</BlockStack>
																</Card>
															);
														},
													)}
												</BlockStack>

												{/* Summary Footer */}
												{stats.isSignificant && (
													<InlineStack gap='400' align='start'>
														<Text
															as='span'
															variant='bodySm'
															tone='success'
															fontWeight='semibold'
														>
															✓ Significant
														</Text>
													</InlineStack>
												)}
											</BlockStack>
										</Card>
									);
								}

								// Product-scoped test (existing logic)
								const variantAImages = parseImageUrls(
									test.variants.find((v: any) => v.variant === 'A' && !v.shopifyVariantId)?.imageUrls,
								);
								const variantBImages = parseImageUrls(
									test.variants.find((v: any) => v.variant === 'B' && !v.shopifyVariantId)?.imageUrls,
								);

								return (
									<Card key={test.id}>
										<BlockStack gap='300'>
											{/* Test Header */}
											<InlineStack align='space-between' wrap={false}>
												<InlineStack gap='200' align='start'>
													<Text as='h4' variant='headingSm'>
														{test.name}
													</Text>
													{getStatusBadge(test.status)}
												</InlineStack>
												<InlineStack gap='200'>
													{test.status === 'DRAFT' && (
														<Button
															size='slim'
															variant='primary'
															onClick={() => onTestAction?.(test.id, 'start')}
														>
															Start
														</Button>
													)}
													{test.status === 'RUNNING' && (
														<Button
															size='slim'
															tone='critical'
															onClick={() => onTestAction?.(test.id, 'stop')}
														>
															Stop
														</Button>
													)}
													<Button
														size='slim'
														variant='tertiary'
														tone='critical'
														onClick={() => onTestAction?.(test.id, 'delete')}
													>
														Delete
													</Button>
												</InlineStack>
											</InlineStack>

											{/* Variants Comparison Table (Transposed) */}
											<div
												style={{
													display: 'grid',
													gridTemplateColumns: 'auto auto auto auto',
													gap: '12px',
													alignItems: 'center',
												}}
											>
												{/* Header Row: empty cell for Variant label */}
												<div />
												<Text as='span' variant='bodyMd' fontWeight='semibold'>
													Images
												</Text>
												<Text as='span' variant='bodyMd' fontWeight='semibold'>
													Impressions
												</Text>
												<Text as='span' variant='bodyMd' fontWeight='semibold'>
													ATC
												</Text>

												{/* Variant A Row */}
												<Text as='span' variant='bodyMd' fontWeight='semibold'>
													A {stats.winner === 'A' && stats.isSignificant && '🏆'}
												</Text>
												<InlineStack gap='100' wrap={false}>
													{variantAImages.slice(0, 3).map((url: string, index: number) => (
														<div
															key={index}
															style={{
																width: '84px',
																height: '84px',
																borderRadius: '4px',
																overflow: 'hidden',
																border: '1px solid #E1E3E5',
																flexShrink: 0,
															}}
														>
															<img
																src={url}
																alt={`A${index + 1}`}
																style={{
																	maxWidth: '100%',
																	maxHeight: '100%',
																	width: 'auto',
																	height: 'auto',
																	objectFit: 'contain',
																	display: 'block',
																	margin: '0 auto',
																}}
															/>
														</div>
													))}
													{variantAImages.length > 3 && (
														<Text as='span' variant='bodySm' tone='subdued'>
															+{variantAImages.length - 3}
														</Text>
													)}
												</InlineStack>
												<Text as='span' variant='bodySm'>
													{stats.variantA.impressions.toLocaleString()}
												</Text>
												<Text as='span' variant='bodySm'>
													{stats.variantA.conversions.toLocaleString()}
												</Text>

												{/* Variant B Row */}
												<Text as='span' variant='bodyMd' fontWeight='semibold'>
													B {stats.winner === 'B' && stats.isSignificant && '🏆'}
												</Text>
												<InlineStack gap='100' wrap={false}>
													{variantBImages.slice(0, 3).map((url: string, index: number) => (
														<div
															key={index}
															style={{
																width: '84px',
																height: '84px',
																borderRadius: '4px',
																overflow: 'hidden',
																border: '1px solid #E1E3E5',
																flexShrink: 0,
															}}
														>
															<img
																src={url}
																alt={`B${index + 1}`}
																style={{
																	maxWidth: '100%',
																	maxHeight: '100%',
																	width: 'auto',
																	height: 'auto',
																	objectFit: 'contain',
																	display: 'block',
																	margin: '0 auto',
																}}
															/>
														</div>
													))}
													{variantBImages.length > 3 && (
														<Text as='span' variant='bodySm' tone='subdued'>
															+{variantBImages.length - 3}
														</Text>
													)}
												</InlineStack>
												<Text as='span' variant='bodySm'>
													{stats.variantB.impressions.toLocaleString()}
												</Text>
												<Text as='span' variant='bodySm'>
													{stats.variantB.conversions.toLocaleString()}
												</Text>
											</div>

											{/* Summary Footer */}
											{stats.isSignificant && (
												<InlineStack gap='400' align='start'>
													<Text
														as='span'
														variant='bodySm'
														tone='success'
														fontWeight='semibold'
													>
														✓ Significant
													</Text>
												</InlineStack>
											)}
										</BlockStack>
									</Card>
								);
							})}
						</BlockStack>
					</BlockStack>
				</Card>
			)}

			{/* Empty State for No Tests */}
			{existingTests.length === 0 && !showCreator && (
				<Card>
					<EmptyState
						heading='No A/B tests created yet'
						image='https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png'
					>
						<Text as='p'>
							Start optimizing your product images by creating your first A/B test. Compare different
							image variants to see which performs better.
						</Text>
						<div style={{ marginTop: '16px' }}>
							<Button
								variant='primary'
								onClick={() => setShowCreator(true)}
								disabled={availableImages.length < 2 || !!activeTest}
							>
								Create Your First Test
							</Button>
						</div>
					</EmptyState>
				</Card>
			)}
		</BlockStack>
	);
}
