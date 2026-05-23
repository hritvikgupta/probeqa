// Type declaration for MDX blog posts. Each post in src/blog/*.mdx exports a
// `meta` object alongside the default React component. @types/mdx only types
// the default export, so this augments it with `meta`.
declare module '*.mdx' {
  import type { ComponentType } from 'react';
  export const meta: {
    slug: string;
    title: string;
    description: string;
    keywords: string;
    date: string;
    dateLabel: string;
    readingTime: string;
    author: string;
    tag: string;
    cover?: string;
  };
  const Component: ComponentType;
  export default Component;
}
