// Public blog at /blog (index) and /blog/:slug (post).
// Both views share the Landing aesthetic and are SEO-tuned: document title +
// meta description + keywords + canonical + JSON-LD structured data, semantic
// <article>/<header>/<section> markup, and internal cross-links between posts.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MDXProvider } from '@mdx-js/react';
import { BLOG_POSTS, findPost, type BlogMeta } from '../lib/blogPosts';
import './Blog.css';

const SITE = 'https://www.probe.dev';

// ---------- brand ----------------------------------------------------------

// The voxel cube logo, lifted from the Landing nav so the blog matches.
function ProbeCube({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" shapeRendering="crispEdges" width={size} height={size}>
      <polygon points="12,2 22,7 12,12 2,7" fill="#A8A8A8" />
      <polygon points="12,2 22,7 12,12 2,7" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
      <polygon points="2,7 12,12 12,22 2,17" fill="#545454" />
      <polygon points="2,7 12,12 12,22 2,17" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
      <polygon points="22,7 12,12 12,22 22,17" fill="#3A3A3A" />
      <polygon points="22,7 12,12 12,22 22,17" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
    </svg>
  );
}

// ---------- SEO helpers ----------------------------------------------------

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return el;
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  return el;
}

function upsertJsonLd(id: string, data: object) {
  let el = document.head.querySelector<HTMLScriptElement>(`script[data-jsonld="${id}"]`);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.setAttribute('data-jsonld', id);
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
  return el;
}

function useSeo(opts: {
  title: string;
  description: string;
  keywords: string;
  canonical: string;
  og?: { type?: string; publishedTime?: string };
  jsonLd?: object;
}) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = opts.title;

    upsertMeta('name', 'description', opts.description);
    upsertMeta('name', 'keywords', opts.keywords);
    upsertLink('canonical', opts.canonical);

    upsertMeta('property', 'og:title', opts.title);
    upsertMeta('property', 'og:description', opts.description);
    upsertMeta('property', 'og:url', opts.canonical);
    upsertMeta('property', 'og:type', opts.og?.type || 'website');
    upsertMeta('property', 'og:site_name', 'Probe');
    if (opts.og?.publishedTime) {
      upsertMeta('property', 'article:published_time', opts.og.publishedTime);
    }

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', opts.title);
    upsertMeta('name', 'twitter:description', opts.description);

    if (opts.jsonLd) upsertJsonLd('post', opts.jsonLd);

    return () => {
      document.title = prevTitle;
    };
  }, [
    opts.title,
    opts.description,
    opts.keywords,
    opts.canonical,
    opts.og?.publishedTime,
    opts.jsonLd && JSON.stringify(opts.jsonLd),
  ]);
}

// Scroll to top whenever the active post changes.
function useScrollTop(key?: string) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);
}

// ---------- shared chrome --------------------------------------------------

function BlogNav() {
  return (
    <nav className="blog-nav">
      <div className="wrap blog-nav-inner">
        <Link to="/" className="brand">
          <span className="brand-mark"><ProbeCube /></span>
          <span className="brand-text">Probe</span>
        </Link>
        <div className="blog-nav-links">
          <Link to="/">Home</Link>
          <Link to="/blog" className="active">Blog</Link>
          <Link to="/docs">Docs</Link>
        </div>
        <div className="blog-nav-cta">
          <Link to="/login" className="btn ghost">Log in</Link>
          <Link to="/signup" className="btn primary">Sign up</Link>
        </div>
      </div>
    </nav>
  );
}

function BlogFooter() {
  return (
    <footer className="blog-foot">
      <div className="wrap">
        <div className="blog-foot-row">
          <Link to="/" className="brand">
            <span className="brand-mark"><ProbeCube /></span>
            <span className="brand-text">Probe</span>
          </Link>
          <span className="blog-foot-meta">
            © {new Date().getFullYear()} Probe Labs, Inc. ·
            <Link to="/blog"> Blog</Link> ·
            <Link to="/docs"> Docs</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}

function CoverArt({ kind }: { kind?: string }) {
  const k = kind || 'guide';
  return (
    <div className={`cover cover-${k}`}>
      <ProbeCube size={28} />
    </div>
  );
}

// ---------- index ----------------------------------------------------------

export function BlogIndex() {
  useScrollTop();

  const canonical = `${SITE}/blog`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Probe Blog',
    url: canonical,
    description:
      'Engineering notes and guides on autonomous web testing with Probe.',
    publisher: { '@type': 'Organization', name: 'Probe Labs', url: SITE },
    blogPost: BLOG_POSTS.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.meta.title,
      description: p.meta.description,
      datePublished: p.meta.date,
      url: `${SITE}/blog/${p.meta.slug}`,
      author: { '@type': 'Organization', name: p.meta.author },
    })),
  };

  useSeo({
    title: 'Probe Blog | Autonomous Web Testing',
    description:
      'Engineering posts and guides from the team building Probe, the agent that tests your web app by driving a real browser.',
    keywords:
      'AI testing agent blog, autonomous QA, automated browser testing, end to end testing, AI QA engineering, Probe blog',
    canonical,
    jsonLd,
  });

  const [featured, ...rest] = BLOG_POSTS;

  return (
    <div className="probe-blog blog-root">
      <BlogNav />

      <header className="blog-hero">
        <div className="wrap">
          <div className="blog-eyebrow">The Probe Blog</div>
          <h1>Notes from the team building autonomous web testing.</h1>
          <p>
            Guides and engineering posts on how agents test software,
            why scripted suites stop scaling, and what to ship next.
          </p>
        </div>
      </header>

      <main className="blog-list wrap">
        <article className="blog-card blog-card-featured">
          <Link to={`/blog/${featured.meta.slug}`} className="blog-card-link">
            <CoverArt kind={featured.meta.cover} />
            <div className="blog-card-body">
              <div className="blog-card-meta">
                <span className="blog-tag">{featured.meta.tag}</span>
                <time dateTime={featured.meta.date}>{featured.meta.dateLabel}</time>
                <span>·</span>
                <span>{featured.meta.readingTime}</span>
              </div>
              <h2>{featured.meta.title}</h2>
              <p>{featured.meta.description}</p>
              <span className="blog-card-cta">Read post →</span>
            </div>
          </Link>
        </article>

        <div className="blog-grid">
          {rest.map((p) => (
            <article key={p.meta.slug} className="blog-card">
              <Link to={`/blog/${p.meta.slug}`} className="blog-card-link">
                <CoverArt kind={p.meta.cover} />
                <div className="blog-card-body">
                  <div className="blog-card-meta">
                    <span className="blog-tag">{p.meta.tag}</span>
                    <time dateTime={p.meta.date}>{p.meta.dateLabel}</time>
                    <span>·</span>
                    <span>{p.meta.readingTime}</span>
                  </div>
                  <h3>{p.meta.title}</h3>
                  <p>{p.meta.description}</p>
                  <span className="blog-card-cta">Read post →</span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </main>

      <BlogFooter />
    </div>
  );
}

// ---------- post -----------------------------------------------------------

function buildPostJsonLd(m: BlogMeta) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: m.title,
    description: m.description,
    keywords: m.keywords,
    datePublished: m.date,
    dateModified: m.date,
    author: { '@type': 'Organization', name: m.author },
    publisher: { '@type': 'Organization', name: 'Probe Labs', url: SITE },
    mainEntityOfPage: `${SITE}/blog/${m.slug}`,
    inLanguage: 'en-US',
  };
}

const mdxComponents = {
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => <pre {...props} />,
};

export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  useScrollTop(slug);
  const entry = slug ? findPost(slug) : undefined;

  const meta = entry?.meta;
  const canonical = meta ? `${SITE}/blog/${meta.slug}` : `${SITE}/blog`;

  useSeo({
    title: meta ? `${meta.title} | Probe Blog` : 'Post not found | Probe Blog',
    description:
      meta?.description ||
      'This post is no longer available. Browse the Probe blog for guides on autonomous web testing.',
    keywords: meta?.keywords || 'Probe blog, AI testing agent',
    canonical,
    og: meta ? { type: 'article', publishedTime: meta.date } : { type: 'website' },
    jsonLd: meta ? buildPostJsonLd(meta) : undefined,
  });

  if (!entry || !meta) {
    return (
      <div className="probe-blog blog-root">
        <BlogNav />
        <main className="blog-missing wrap">
          <h1>Post not found.</h1>
          <p>We can't find a post at that URL. It may have been moved or renamed.</p>
          <Link to="/blog" className="btn primary">Back to the blog</Link>
        </main>
        <BlogFooter />
      </div>
    );
  }

  const Component = entry.Component;
  const related = BLOG_POSTS.filter((p) => p.meta.slug !== meta.slug).slice(0, 3);

  return (
    <div className="probe-blog blog-root">
      <BlogNav />

      <article className="blog-post wrap">
        <header className="blog-post-head">
          <div className="blog-post-meta">
            <Link to="/blog" className="blog-back">← All posts</Link>
            <span className="blog-tag">{meta.tag}</span>
            <time dateTime={meta.date}>{meta.dateLabel}</time>
            <span>·</span>
            <span>{meta.readingTime}</span>
          </div>
          <h1>{meta.title}</h1>
          <p className="blog-post-dek">{meta.description}</p>
          <div className="blog-post-author">
            <span className="brand-mark"><ProbeCube size={18} /></span>
            <span>{meta.author}</span>
          </div>
        </header>

        <div className="blog-post-body">
          <MDXProvider components={mdxComponents}>
            <Component />
          </MDXProvider>
        </div>

        <aside className="blog-related">
          <h2>Keep reading</h2>
          <ul>
            {related.map((p) => (
              <li key={p.meta.slug}>
                <Link to={`/blog/${p.meta.slug}`}>
                  <span className="blog-tag">{p.meta.tag}</span>
                  <span className="rel-title">{p.meta.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </article>

      <BlogFooter />
    </div>
  );
}
