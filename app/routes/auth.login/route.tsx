import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log("[auth.login] Login page accessed");
  console.log("[auth.login] URL:", request.url);
  console.log("[auth.login] Shop param:", url.searchParams.get("shop"));

  const loginResult = await login(request);
  console.log("[auth.login] Login result:", loginResult);

  const errors = loginErrorMessage(loginResult);
  console.log("[auth.login] Errors:", errors);

  return { errors, polarisTranslations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Clone request before consuming body, since login() needs to read it
  const clonedRequest = request.clone();

  // Read formData from clone for logging (preserves original for login)
  const formData = await clonedRequest.formData();
  const shop = formData.get("shop");
  console.log("[auth.login] Login form submitted");
  console.log("[auth.login] Shop from form:", shop);

  // Use original request for login() which will read the body
  const loginResult = await login(request);
  console.log("[auth.login] Login action result:", loginResult);

  const errors = loginErrorMessage(loginResult);

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
