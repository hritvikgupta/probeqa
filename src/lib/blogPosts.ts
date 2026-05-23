// Blog registry. Each post is an MDX file with an exported `meta` object
// plus the default React component for the body. We import them all here
// so the Blog screen can list them and look them up by slug.

import type { ComponentType } from 'react';
import ProbeV2, { meta as probeV2Meta } from '../blog/announcing-probe-2.mdx';
import WhatIs, { meta as whatIsMeta } from '../blog/what-is-an-ai-testing-agent.mdx';
import HowTest, { meta as howTestMeta } from '../blog/how-ai-agents-test-web-apps.mdx';
import ManualQa, { meta as manualQaMeta } from '../blog/manual-qa-doesnt-scale.mdx';
import Coverage, { meta as coverageMeta } from '../blog/measuring-test-coverage-with-agents.mdx';

export type BlogMeta = {
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

export type BlogEntry = {
  meta: BlogMeta;
  Component: ComponentType;
};

export const BLOG_POSTS: BlogEntry[] = [
  { meta: probeV2Meta, Component: ProbeV2 },
  { meta: whatIsMeta, Component: WhatIs },
  { meta: howTestMeta, Component: HowTest },
  { meta: manualQaMeta, Component: ManualQa },
  { meta: coverageMeta, Component: Coverage },
].sort((a, b) => (a.meta.date < b.meta.date ? 1 : -1));

export function findPost(slug: string): BlogEntry | undefined {
  return BLOG_POSTS.find((p) => p.meta.slug === slug);
}
