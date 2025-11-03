import { useState } from 'react';
import {
	Card,
	Text,
	Button,
	BlockStack,
	FormLayout,
	TextField,
	Select,
	InlineStack,
	Grid,
	Box,
	Divider,
} from '@shopify/polaris';
import type { ABTestCreateRequest } from '../types';

interface ABTestCreatorProps {
	productId: string;
	availableImages: string[];
	variants?: any[];
	onTestCreate: (request: ABTestCreateRequest) => void;
	isCreating?: boolean;
}

export function ABTestCreator({
	productId,
	availableImages,
	variants,
	onTestCreate,
	isCreating = false,
}: ABTestCreatorProps) {
	const [testName, setTestName] = useState('');
	const [selectedVariant, setSelectedVariant] = useState<'A' | 'B'>('A');
	const [selectionCounter, setSelectionCounter] = useState(0);

	const hasMultipleVariants = variants && variants.length > 1;
	const showVariantOptions =
		hasMultipleVariants || (variants && variants.length === 1 && variants[0].title !== 'Default Title');
	const testScope: 'PRODUCT' | 'VARIANT' = showVariantOptions ? 'VARIANT' : 'PRODUCT';

	const [variantAImages, setVariantAImages] = useState<Map<string, number>>(new Map());
	const [variantBImages, setVariantBImages] = useState<Map<string, number>>(new Map());

	const [selectedProductVariantId, setSelectedProductVariantId] = useState<string>(
		variants && variants.length > 0 ? variants[0].id : '',
	);
	const [variantTests, setVariantTests] = useState<
		Map<
			string,
			{
				variantAImages: Map<string, number>;
				variantBImages: Map<string, number>;
			}
		>
	>(new Map());

	const formatVariantTitle = (variant: any): string => {
		if (variant.title === 'Default Title') {
			return 'Default Variant';
		}
		const options = variant.selectedOptions?.map((opt: any) => opt.value).join(' / ');
		return options || variant.title;
	};

	const handleImageToggle = (imageUrl: string, testVariant: 'A' | 'B') => {
		if (testScope === 'PRODUCT') {
			if (testVariant === 'A') {
				setVariantAImages(prev => {
					const newMap = new Map(prev);
					if (newMap.has(imageUrl)) {
						newMap.delete(imageUrl);
					} else {
						newMap.set(imageUrl, selectionCounter);
						setSelectionCounter(c => c + 1);
					}
					return newMap;
				});
			} else {
				setVariantBImages(prev => {
					const newMap = new Map(prev);
					if (newMap.has(imageUrl)) {
						newMap.delete(imageUrl);
					} else {
						newMap.set(imageUrl, selectionCounter);
						setSelectionCounter(c => c + 1);
					}
					return newMap;
				});
			}
		} else {
			setVariantTests(prev => {
				const newMap = new Map(prev);
				const current = newMap.get(selectedProductVariantId) || {
					variantAImages: new Map(),
					variantBImages: new Map(),
				};

				const imageMap = testVariant === 'A' ? current.variantAImages : current.variantBImages;
				const newImageMap = new Map(imageMap);

				if (newImageMap.has(imageUrl)) {
					newImageMap.delete(imageUrl);
				} else {
					newImageMap.set(imageUrl, selectionCounter);
					setSelectionCounter(c => c + 1);
				}

				newMap.set(selectedProductVariantId, {
					...current,
					[testVariant === 'A' ? 'variantAImages' : 'variantBImages']: newImageMap,
				});

				return newMap;
			});
		}
	};

	const handleSubmit = () => {
		if (!testName) return;

		if (testScope === 'PRODUCT') {
			if (variantAImages.size === 0 || variantBImages.size === 0) {
				alert('Please select images for both Variant A and Variant B');
				return;
			}

			const sortedAImages = Array.from(variantAImages.entries())
				.sort((a, b) => a[1] - b[1])
				.map(([url]) => url)
				.slice(0, 6);

			const filteredBEntries = Array.from(variantBImages.entries())
				.sort((a, b) => a[1] - b[1])
				.filter(([url]) => !sortedAImages.includes(url));

			const sortedBImages = filteredBEntries.map(([url]) => url).slice(0, 6);

			if (sortedAImages.length === 0 || sortedBImages.length === 0) {
				alert('Each variant must contain at least one unique image (max 6 per variant)');
				return;
			}

			onTestCreate({
				name: testName,
				productId,
				variantScope: 'PRODUCT',
				variantAImages: sortedAImages,
				variantBImages: sortedBImages,
				trafficSplit: 50,
			});
		} else {
			const enabledVariantTests = Array.from(variantTests.entries())
				.filter(([_, test]) => test.variantAImages.size > 0 && test.variantBImages.size > 0)
				.map(([variantId, test]) => ({
					shopifyVariantId: variantId,
					variantAImages: Array.from(test.variantAImages.entries())
						.sort((a, b) => a[1] - b[1])
						.map(([url]) => url)
						.slice(0, 6),
					variantBImages: Array.from(test.variantBImages.entries())
						.sort((a, b) => a[1] - b[1])
						.map(([url]) => url)
						.slice(0, 6),
				}));

			if (enabledVariantTests.length === 0) {
				alert('Please select images for at least one variant (both A and B sets)');
				return;
			}

			onTestCreate({
				name: testName,
				productId,
				variantScope: 'VARIANT',
				variantTests: enabledVariantTests,
				trafficSplit: 50,
			});
		}
	};

	const getCurrentVariantTestData = () => {
		if (testScope === 'PRODUCT') {
			return {
				variantAImages,
				variantBImages,
			};
		} else {
			return (
				variantTests.get(selectedProductVariantId) || {
					variantAImages: new Map(),
					variantBImages: new Map(),
				}
			);
		}
	};

	const currentData = getCurrentVariantTestData();
	const variantASelection = Array.from(currentData.variantAImages.entries())
		.sort((a, b) => a[1] - b[1])
		.map(([url]) => url);

	const variantBSelection = Array.from(currentData.variantBImages.entries())
		.sort((a, b) => a[1] - b[1])
		.filter(([url]) => !variantASelection.includes(url))
		.map(([url]) => url);

	const getAllImageSelections = () => {
		if (testScope === 'PRODUCT') {
			return { variantAImages, variantBImages };
		}
		const allA = new Map<string, { variantId: string; order: number }>();
		const allB = new Map<string, { variantId: string; order: number }>();

		variantTests.forEach((test, variantId) => {
			test.variantAImages.forEach((order, url) => {
				allA.set(url, { variantId, order });
			});
			test.variantBImages.forEach((order, url) => {
				allB.set(url, { variantId, order });
			});
		});

		return { allA, allB };
	};

	const allSelections = getAllImageSelections();

	const hasAnyValidVariant =
		testScope === 'VARIANT'
			? Array.from(variantTests.values()).some(
					test => test.variantAImages.size > 0 && test.variantBImages.size > 0,
				)
			: false;

	const isValid =
		testName &&
		(testScope === 'PRODUCT' ? variantASelection.length > 0 && variantBSelection.length > 0 : hasAnyValidVariant);

	const getConfiguredVariantsCount = () => {
		return Array.from(variantTests.values()).filter(
			test => test.variantAImages.size > 0 && test.variantBImages.size > 0,
		).length;
	};

	return (
		<Card>
			<BlockStack gap='500'>
				<BlockStack gap='200'>
					<Text as='h2' variant='headingLg'>
						Create A/B Test
					</Text>
					<Text as='p' variant='bodyMd' tone='subdued'>
						Set up an A/B test to compare different image variants and measure their impact on conversions.
					</Text>
				</BlockStack>

				<Divider />

				<Grid columns={{ xs: 1, lg: 2 }}>
					<BlockStack gap='400'>
						<FormLayout>
							<TextField
								label='Test Name'
								value={testName}
								onChange={setTestName}
								placeholder='e.g., Hero Image Comparison Test'
								autoComplete='off'
								helpText='Give your test a descriptive name for easy identification'
							/>

							{testScope === 'VARIANT' && variants && (
								<Select
									label='Configure Variant'
									options={variants.map(v => ({
										label: formatVariantTitle(v),
										value: v.id,
									}))}
									value={selectedProductVariantId}
									onChange={setSelectedProductVariantId}
									helpText='Select which product variant to configure. You can set different A/B tests for each variant.'
								/>
							)}
						</FormLayout>

						<BlockStack gap='300'>
							<Text as='h3' variant='headingMd'>
								Test Summary
							</Text>
							<Card>
								<BlockStack gap='200'>
									{testScope === 'PRODUCT' ? (
										<>
											<InlineStack align='space-between'>
												<Text as='p' variant='bodyMd'>
													Variant A Images:
												</Text>
												<Text
													as='p'
													variant='bodyMd'
													tone={variantAImages.size > 0 ? 'success' : 'subdued'}
												>
													{variantAImages.size} selected
												</Text>
											</InlineStack>
											<InlineStack align='space-between'>
												<Text as='p' variant='bodyMd'>
													Variant B Images:
												</Text>
												<Text
													as='p'
													variant='bodyMd'
													tone={variantBImages.size > 0 ? 'success' : 'subdued'}
												>
													{variantBImages.size} selected
												</Text>
											</InlineStack>
										</>
									) : (
										<>
											<InlineStack align='space-between'>
												<Text as='p' variant='bodyMd'>
													Current Variant A:
												</Text>
												<Text
													as='p'
													variant='bodyMd'
													tone={currentData.variantAImages.size > 0 ? 'success' : 'subdued'}
												>
													{currentData.variantAImages.size} selected
												</Text>
											</InlineStack>
											<InlineStack align='space-between'>
												<Text as='p' variant='bodyMd'>
													Current Variant B:
												</Text>
												<Text
													as='p'
													variant='bodyMd'
													tone={currentData.variantBImages.size > 0 ? 'success' : 'subdued'}
												>
													{currentData.variantBImages.size} selected
												</Text>
											</InlineStack>
											<Divider />
											<InlineStack align='space-between'>
												<Text as='p' variant='bodyMd'>
													Configured Variants:
												</Text>
												<Text
													as='p'
													variant='bodyMd'
													tone={getConfiguredVariantsCount() > 0 ? 'success' : 'subdued'}
												>
													{getConfiguredVariantsCount()} of {variants?.length || 0}
												</Text>
											</InlineStack>
										</>
									)}
									<InlineStack align='space-between'>
										<Text as='p' variant='bodyMd'>
											Traffic Split:
										</Text>
										<Text as='p' variant='bodyMd'>
											50% / 50%
										</Text>
									</InlineStack>
								</BlockStack>
							</Card>
						</BlockStack>
					</BlockStack>

					<BlockStack gap='300'>
						<InlineStack align='space-between' wrap={false}>
							<Text as='h3' variant='headingMd'>
								Select Images
							</Text>
							<InlineStack gap='200'>
								<Button
									size='micro'
									variant={selectedVariant === 'A' ? 'primary' : 'secondary'}
									onClick={() => setSelectedVariant('A')}
								>
									Variant A ({currentData.variantAImages.size.toString()})
								</Button>
								<Button
									size='micro'
									variant={selectedVariant === 'B' ? 'primary' : 'secondary'}
									onClick={() => setSelectedVariant('B')}
								>
									Variant B ({currentData.variantBImages.size.toString()})
								</Button>
							</InlineStack>
						</InlineStack>

						<Card>
							<Box padding='300'>
								<div
									style={{
										display: 'grid',
										gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
										gap: '16px',
									}}
								>
									{availableImages.map((imageUrl, index) => {
										const currentVariantA = currentData.variantAImages;
										const currentVariantB = currentData.variantBImages;

										const isSelectedAInCurrent = currentVariantA.has(imageUrl);
										const isSelectedBInCurrent = currentVariantB.has(imageUrl);
										const isSelected =
											selectedVariant === 'A' ? isSelectedAInCurrent : isSelectedBInCurrent;

										let selectionOrder: number | null = null;
										if (isSelectedAInCurrent) {
											const allAEntries = Array.from(currentVariantA.entries()).sort(
												(a, b) => a[1] - b[1],
											);
											selectionOrder = allAEntries.findIndex(([url]) => url === imageUrl) + 1;
										} else if (isSelectedBInCurrent) {
											const allBEntries = Array.from(currentVariantB.entries()).sort(
												(a, b) => a[1] - b[1],
											);
											selectionOrder = allBEntries.findIndex(([url]) => url === imageUrl) + 1;
										}

										const imageVariant = isSelectedAInCurrent
											? 'A'
											: isSelectedBInCurrent
												? 'B'
												: null;

										let isInOtherProductVariant = false;
										let otherVariantLabel = '';
										if (testScope === 'VARIANT' && !isSelectedAInCurrent && !isSelectedBInCurrent) {
											if (allSelections.allA && allSelections.allA.has(imageUrl)) {
												const info = allSelections.allA.get(imageUrl)!;
												if (info.variantId !== selectedProductVariantId) {
													isInOtherProductVariant = true;
													const variant = variants?.find(v => v.id === info.variantId);
													otherVariantLabel = variant
														? `A: ${formatVariantTitle(variant)}`
														: 'A: Other';
												}
											} else if (allSelections.allB && allSelections.allB.has(imageUrl)) {
												const info = allSelections.allB.get(imageUrl)!;
												if (info.variantId !== selectedProductVariantId) {
													isInOtherProductVariant = true;
													const variant = variants?.find(v => v.id === info.variantId);
													otherVariantLabel = variant
														? `B: ${formatVariantTitle(variant)}`
														: 'B: Other';
												}
											}
										}

										return (
											<div
												key={`${selectedVariant}-${index}`}
												style={{
													cursor: 'pointer',
													transition: 'all 0.2s ease',
													position: 'relative',
												}}
												onClick={() => handleImageToggle(imageUrl, selectedVariant)}
											>
												<div
													style={{
														border: isSelected
															? '3px solid #008060'
															: isSelectedAInCurrent || isSelectedBInCurrent
																? '2px solid #FFA500'
																: isInOtherProductVariant
																	? '2px dashed #CCCCCC'
																	: '2px solid #E1E3E5',
														borderRadius: '12px',
														padding: '8px',
														backgroundColor: isSelected
															? '#F0FAF7'
															: isSelectedAInCurrent || isSelectedBInCurrent
																? '#FFF5E6'
																: isInOtherProductVariant
																	? '#F9F9F9'
																	: '#FFFFFF',
														transform: isSelected ? 'scale(1.02)' : 'scale(1)',
														boxShadow: isSelected
															? '0 4px 12px rgba(0, 128, 96, 0.15)'
															: isSelectedAInCurrent || isSelectedBInCurrent
																? '0 2px 8px rgba(255, 165, 0, 0.1)'
																: '0 2px 4px rgba(0, 0, 0, 0.05)',
													}}
												>
													<div
														style={{
															width: '100%',
															maxHeight: '180px',
															display: 'flex',
															alignItems: 'center',
															justifyContent: 'center',
															overflow: 'hidden',
															borderRadius: '8px',
															backgroundColor: '#F6F6F7',
														}}
													>
														<img
															src={imageUrl}
															alt={
																selectedVariant === 'A'
																	? `Variant A option ${index + 1}`
																	: `Variant B option ${index + 1}`
															}
															style={{
																maxWidth: '100%',
																maxHeight: '180px',
																width: 'auto',
																height: 'auto',
																objectFit: 'contain',
																borderRadius: '8px',
																opacity: isInOtherProductVariant ? 0.6 : 1,
															}}
														/>
													</div>
													{(isSelectedAInCurrent || isSelectedBInCurrent) && (
														<>
															<div
																style={{
																	position: 'absolute',
																	top: '12px',
																	left: '12px',
																	backgroundColor:
																		imageVariant === 'A' ? '#008060' : '#0066CC',
																	color: 'white',
																	borderRadius: '12px',
																	padding: '2px 8px',
																	display: 'flex',
																	alignItems: 'center',
																	fontSize: '11px',
																	fontWeight: 'bold',
																	boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
																}}
															>
																{imageVariant} #{selectionOrder}
															</div>

															{isSelected && (
																<div
																	style={{
																		position: 'absolute',
																		top: '12px',
																		right: '12px',
																		backgroundColor: '#008060',
																		color: 'white',
																		borderRadius: '50%',
																		width: '24px',
																		height: '24px',
																		display: 'flex',
																		alignItems: 'center',
																		justifyContent: 'center',
																		fontSize: '14px',
																		fontWeight: 'bold',
																		boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
																	}}
																>
																	✓
																</div>
															)}
														</>
													)}
													{isInOtherProductVariant && (
														<div
															style={{
																position: 'absolute',
																bottom: '8px',
																left: '8px',
																right: '8px',
																backgroundColor: 'rgba(0, 0, 0, 0.75)',
																color: 'white',
																borderRadius: '4px',
																padding: '4px',
																fontSize: '9px',
																fontWeight: 'bold',
																textAlign: 'center',
																overflow: 'hidden',
																textOverflow: 'ellipsis',
																whiteSpace: 'nowrap',
															}}
															title={otherVariantLabel}
														>
															{otherVariantLabel}
														</div>
													)}
												</div>
											</div>
										);
									})}
								</div>
							</Box>
						</Card>

						<Text as='p' variant='bodySm' tone='subdued' alignment='center'>
							Click images to add them to {selectedVariant === 'A' ? 'Variant A' : 'Variant B'}.{' '}
							{testScope === 'VARIANT' &&
								'Images with dashed borders are used in other product variants.'}
						</Text>
					</BlockStack>
				</Grid>

				<Divider />

				<InlineStack align='end' gap='200'>
					<Text as='p' variant='bodySm' tone={isValid ? 'success' : 'critical'}>
						{!testName && 'Please enter a test name. '}
						{testScope === 'PRODUCT' && variantASelection.length === 0 && 'Select images for Variant A. '}
						{testScope === 'PRODUCT' && variantBSelection.length === 0 && 'Select images for Variant B. '}
						{testScope === 'VARIANT' &&
							!hasAnyValidVariant &&
							'Select images for at least one variant (both A and B). '}
						{isValid && 'Ready to create A/B test!'}
					</Text>
					<Button
						variant='primary'
						onClick={handleSubmit}
						disabled={!isValid || isCreating}
						loading={isCreating}
						size='large'
					>
						{isCreating ? 'Creating Test...' : 'Create A/B Test'}
					</Button>
				</InlineStack>
			</BlockStack>
		</Card>
	);
}
