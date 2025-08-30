import {
  reactExtension,
  useApi,
  BlockStack,
  Text,
} from '@shopify/ui-extensions-react/admin';
import {useState, useEffect} from 'react';

// The target used here must match the target used in the extension's toml file (./shopify.extension.toml)
export default reactExtension('admin.product-variant-details.configuration.render', () => <App />);

function App() {
  
  const {extension: {target}, i18n} = useApi<'admin.product-variant-details.configuration.render'>();
  
  const productVariant = useProductVariant();
  return (
    <BlockStack>
      <Text>
        {i18n.translate('welcome', {target})}
      </Text>
      {productVariant?.productVariantComponents.map((component) =>
        <Text key={component.id}>{component.title}</Text>
      )}
    </BlockStack>
  );
}

function useProductVariant() {
  
  const {data, query} = useApi<'admin.product-variant-details.configuration.render'>();
  const productVariantId = (data as any)?.selected[0].id;
  const [productVariant, setProductVariant] = useState<{
    id: string;
    title: string;
    productVariantComponents: {
      id: string;
      title: string;
    }[];
  }>(null);
  

  useEffect(() => {
    query(
      `#graphql
      query GetProductVariant($id: ID!) {
        productVariant(id: $id) {
          id
          title
          productVariantComponents(first: 100) {
            nodes {
              productVariant {
                id
                title
              }
            }
          }
        }
      }
      `,
      {variables: {id: productVariantId}}
    ).then(({data, errors}) => {
      if (errors) {
        console.error(errors);
      } else {
        
        const {productVariantComponents, ...productVariant} = (data as {
          productVariant: {
            id: string;
            title: string;
            productVariantComponents: {
              nodes: {
                productVariant: {
                  id: string;
                  title: string;
                }
              }[]
            }
          }
        }).productVariant;
        
        setProductVariant({
          ...productVariant,
          productVariantComponents: productVariantComponents.nodes.map(({productVariant}) => ({
            ...productVariant
          }))
        })
      }
    })
  }, [productVariantId, query])

  return productVariant;
}