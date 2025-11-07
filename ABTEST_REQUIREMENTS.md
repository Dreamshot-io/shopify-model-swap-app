A/B Testing Refactor

This is a plugin for Shopify that substitutes product media images with user-selected images.

It does it at different levels:

- Product level
	- At the product level, The user can test a new set of images that substitute the base case gallery. The user can select as many images as it wants.
- Variant level
	- At the variant level, Shopify allows variant combination hero image, so the user can select one image per variant or variant combination.


Examples:
	- The shop has a cap product, with no variations. The shopify product has a base case (the shop current status) and a test case (the new user selected images). This plugin will capture the state of each case, and rotate between them. When the test is finished or deleted, the product will be restored to the base case.
	- The shop has a scarf product with colors. The user can select the product gallery images as before, but now can select a hero image for each color.
	- The shop has a sofa product with the frame colors and the cushions colors as variations. The user can select a product gallery set of images, and a hero image for each combination of frame/cushions.

How it should work:
	- A cron job triggered in vercel infra will launch the rotation event, which will list each product with tests enabled. It will check:
		- the current state of the test and which images are set
		- The target state and which images are set
	- The cron will then call shopify to delete the current media and upload the target media, properly assigned to the type of media we're uploading:
		- Product media images must be uploaded to product Gallery
		- Variant hero images must be uploaded to Variant Hero
	- We must update the data in the database to reflect the new state of the rotation.
	- We will have toggles in the UI to let the user manually trigger the test or the base case, independently of our current rotation status.

Events recorded
Part of the mission of this plugin is to record events regarding the product impressions, add to cart, and orders. This events must be timestamped in a way that we can later identify which product images and variant heros produced more impressions, more add to cart, and more purchases.

We will also store the impressions and ATC events in the test case and base case information in the database, so it is faster to retrieve and show in the UI.

Impressions and add to carts are events we must record with a pixel in shopify, or via injected Javascript in the template. Order information must be received vía webhooks. We will need the product price in the order, as well as the order total. We will also store the orderId to later retrieve more data if needed.

We have shopify MCP to check API requirements and we use polar, the shopify design system for the UI.
