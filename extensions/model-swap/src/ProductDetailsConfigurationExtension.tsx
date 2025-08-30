import {
  reactExtension,
  useApi,
  BlockStack,
  Button,
} from "@shopify/ui-extensions-react/admin";
import { useState, useEffect } from "react";

// Simple block extension - just shows product info and CTA
export default reactExtension("admin.product-details.block.render", () => (
  <App />
));

function App() {
  const {
    extension: { target },
    i18n,
    navigation,
  } = useApi<"admin.product-details.block.render">();
  const product = useProduct();

  return (
    <BlockStack>
      <Button
        variant="primary"
        onPress={() => {
          console.log("🚀 Opening AI Image Studio...");
          // Navigate to embedded app with product ID
          const productId = product?.id;
          if (productId) {
            // Navigate to the embedded app with full path
            navigation.navigate(
              `/apps/dreamshot-model-swap/app/ai-studio?productId=${encodeURIComponent(productId)}`,
            );
          }
        }}
      >
        🎨 Open AI Studio
      </Button>
    </BlockStack>
  );
}

function useProduct() {
  const { data, query } = useApi<"admin.product-details.block.render">();
  const productId = (data as any)?.selected[0].id;
  const [product, setProduct] = useState<{
    id: string;
    title: string;
    media: Array<{
      id: string;
      image?: {
        url: string;
        altText?: string;
      };
    }>;
  } | null>(null);

  useEffect(() => {
    if (!productId) return;

    query(
      `#graphql
      query GetProductWithMedia($id: ID!) {
        product(id: $id) {
          id
          title
          media(first: 20) {
            nodes {
              id
              ... on MediaImage {
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }
      `,
      { variables: { id: productId } },
    ).then(({ data, errors }) => {
      if (errors) {
        console.error(errors);
      } else {
        const productData = (data as { product: any }).product;
        setProduct({
          id: productData.id,
          title: productData.title,
          media: productData.media.nodes,
        });
      }
    });
  }, [productId, query]);

  return product;
}
