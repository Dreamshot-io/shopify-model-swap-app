declare module "*.css";

// Remix Vite virtual module for the server build
declare module "virtual:remix/server-build" {
  const build: any;
  export = build;
}
