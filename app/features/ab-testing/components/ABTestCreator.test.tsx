import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ABTestCreator } from './ABTestCreator';

describe('ABTestCreator - Selection Order Preservation', () => {
  const mockOnTestCreate = jest.fn();
  const mockProductId = 'product-123';
  const mockImages = [
    'https://example.com/image1.jpg',
    'https://example.com/image2.jpg',
    'https://example.com/image3.jpg',
    'https://example.com/image4.jpg',
    'https://example.com/image5.jpg',
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves selection order when images are selected', async () => {
    render(
      <ABTestCreator
        productId={mockProductId}
        availableImages={mockImages}
        onTestCreate={mockOnTestCreate}
        isCreating={false}
      />
    );

    // Enter test name
    const nameInput = screen.getByLabelText(/test name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Order Preservation' } });

    // Select images for Variant A in specific order: 3rd, 1st, 4th
    const images = screen.getAllByRole('img');

    // Make sure we're on Variant A
    const variantAButton = screen.getByRole('button', { name: /variant a/i });
    fireEvent.click(variantAButton);

    // Select images in order
    fireEvent.click(images[2].closest('div[style]')!); // 3rd image
    fireEvent.click(images[0].closest('div[style]')!); // 1st image
    fireEvent.click(images[3].closest('div[style]')!); // 4th image

    // Switch to Variant B
    const variantBButton = screen.getByRole('button', { name: /variant b/i });
    fireEvent.click(variantBButton);

    // Select images for Variant B: 2nd, 5th
    fireEvent.click(images[1].closest('div[style]')!); // 2nd image
    fireEvent.click(images[4].closest('div[style]')!); // 5th image

    // Submit the form
    const createButton = screen.getByRole('button', { name: /create a\/b test/i });
    fireEvent.click(createButton);

    // Check that onTestCreate was called with images in selection order
    expect(mockOnTestCreate).toHaveBeenCalledWith({
      name: 'Test Order Preservation',
      productId: mockProductId,
      variantAImages: [
        mockImages[2], // 3rd image (selected first)
        mockImages[0], // 1st image (selected second)
        mockImages[3], // 4th image (selected third)
      ],
      variantBImages: [
        mockImages[1], // 2nd image (selected first)
        mockImages[4], // 5th image (selected second)
      ],
      trafficSplit: 50,
    });
  });

  it('maintains selection order when toggling images off and on', async () => {
    render(
      <ABTestCreator
        productId={mockProductId}
        availableImages={mockImages}
        onTestCreate={mockOnTestCreate}
        isCreating={false}
      />
    );

    // Enter test name
    const nameInput = screen.getByLabelText(/test name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Toggle Order' } });

    const images = screen.getAllByRole('img');

    // Select images for Variant A: 1st, 2nd, 3rd
    fireEvent.click(images[0].closest('div[style]')!);
    fireEvent.click(images[1].closest('div[style]')!);
    fireEvent.click(images[2].closest('div[style]')!);

    // Deselect the 2nd image
    fireEvent.click(images[1].closest('div[style]')!);

    // Reselect the 2nd image (should go to end of order)
    fireEvent.click(images[1].closest('div[style]')!);

    // Select one for Variant B to make form valid
    const variantBButton = screen.getByRole('button', { name: /variant b/i });
    fireEvent.click(variantBButton);
    fireEvent.click(images[4].closest('div[style]')!);

    // Submit
    const createButton = screen.getByRole('button', { name: /create a\/b test/i });
    fireEvent.click(createButton);

    // Check order: 1st, 3rd, 2nd (2nd was reselected so goes to end)
    expect(mockOnTestCreate).toHaveBeenCalledWith({
      name: 'Test Toggle Order',
      productId: mockProductId,
      variantAImages: [
        mockImages[0], // 1st image (never deselected)
        mockImages[2], // 3rd image (never deselected)
        mockImages[1], // 2nd image (deselected and reselected, so goes to end)
      ],
      variantBImages: [
        mockImages[4], // 5th image
      ],
      trafficSplit: 50,
    });
  });

  it('shows selection order badges on selected images', async () => {
    const { container } = render(
      <ABTestCreator
        productId={mockProductId}
        availableImages={mockImages}
        onTestCreate={mockOnTestCreate}
        isCreating={false}
      />
    );

    const images = screen.getAllByRole('img');

    // Select images in order
    fireEvent.click(images[2].closest('div[style]')!); // 3rd image
    fireEvent.click(images[0].closest('div[style]')!); // 1st image

    // Look for selection badges
    await waitFor(() => {
      const badges = container.querySelectorAll('div[style*="borderRadius: \\"12px\\""]');
      const badgeTexts = Array.from(badges).map(b => b.textContent);

      expect(badgeTexts).toContain('A #1'); // First selected (3rd image)
      expect(badgeTexts).toContain('A #2'); // Second selected (1st image)
    });
  });

  it('removes images from opposite variant when selecting', async () => {
    render(
      <ABTestCreator
        productId={mockProductId}
        availableImages={mockImages}
        onTestCreate={mockOnTestCreate}
        isCreating={false}
      />
    );

    const images = screen.getAllByRole('img');

    // Select image for Variant A
    const variantAButton = screen.getByRole('button', { name: /variant a/i });
    fireEvent.click(variantAButton);
    fireEvent.click(images[0].closest('div[style]')!);

    // Switch to Variant B and select the same image
    const variantBButton = screen.getByRole('button', { name: /variant b/i });
    fireEvent.click(variantBButton);
    fireEvent.click(images[0].closest('div[style]')!);

    // Select another image for A so we can submit
    fireEvent.click(variantAButton);
    fireEvent.click(images[1].closest('div[style]')!);

    // Enter test name
    const nameInput = screen.getByLabelText(/test name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Variant Switch' } });

    // Submit
    const createButton = screen.getByRole('button', { name: /create a\/b test/i });
    fireEvent.click(createButton);

    // First image should only be in Variant B (was removed from A when added to B)
    expect(mockOnTestCreate).toHaveBeenCalledWith({
      name: 'Test Variant Switch',
      productId: mockProductId,
      variantAImages: [mockImages[1]], // Only 2nd image
      variantBImages: [mockImages[0]], // 1st image (moved from A to B)
      trafficSplit: 50,
    });
  });
});
