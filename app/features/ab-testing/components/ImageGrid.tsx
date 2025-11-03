interface ImageGridProps {
	images: string[];
	selectedImages: Map<string, number>;
	onToggle: (imageUrl: string) => void;
	variant: 'A' | 'B';
	columns?: number;
}

export function ImageGrid({ images, selectedImages, onToggle, variant, columns = 3 }: ImageGridProps) {
	return (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: `repeat(${columns}, 1fr)`,
				gap: '12px',
			}}
		>
			{images.map((imageUrl, index) => {
				const isSelected = selectedImages.has(imageUrl);
				const selectionOrder = isSelected
					? Array.from(selectedImages.entries())
							.sort((a, b) => a[1] - b[1])
							.findIndex(([url]) => url === imageUrl) + 1
					: null;

				return (
					<div
						key={`${variant}-${index}`}
						onClick={() => onToggle(imageUrl)}
						style={{
							cursor: 'pointer',
							border: isSelected
								? `3px solid ${variant === 'A' ? '#008060' : '#0066CC'}`
								: '2px solid #E1E3E5',
							borderRadius: '12px',
							padding: '8px',
							position: 'relative',
							backgroundColor: isSelected ? '#F0FAF7' : '#FFF',
							transition: 'all 0.2s ease',
							transform: isSelected ? 'scale(1.02)' : 'scale(1)',
							boxShadow: isSelected
								? '0 4px 12px rgba(0, 128, 96, 0.15)'
								: '0 2px 4px rgba(0, 0, 0, 0.05)',
						}}
					>
						<div
							style={{
								width: '100%',
								height: '140px',
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
								alt={`Option ${index + 1}`}
								style={{
									maxWidth: '100%',
									maxHeight: '100%',
									width: 'auto',
									height: 'auto',
									objectFit: 'contain',
								}}
							/>
						</div>
						{isSelected && (
							<>
								<div
									style={{
										position: 'absolute',
										top: '8px',
										left: '8px',
										backgroundColor: variant === 'A' ? '#008060' : '#0066CC',
										color: 'white',
										borderRadius: '12px',
										padding: '2px 8px',
										fontSize: '11px',
										fontWeight: 'bold',
										boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
									}}
								>
									{variant} #{selectionOrder}
								</div>
								<div
									style={{
										position: 'absolute',
										top: '8px',
										right: '8px',
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
							</>
						)}
					</div>
				);
			})}
		</div>
	);
}
