import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import idocs from '@the-package-labs/idocs-astro'
import { defineConfig } from 'astro/config'

const repo = 'https://github.com/The-Package-Labs/idocs'
// Redirect targets are not prefixed with `base` by Astro, so a project site would redirect to the wrong root.
const base = (process.env.BASE_PATH ?? '').replace(/\/$/, '')
// Social cards need an absolute address, so the preview image is only linked when SITE_URL is set.
const image = process.env.SITE_URL
  ? `${process.env.SITE_URL.replace(/\/$/, '')}${base}/og.png`
  : undefined

// For GitHub Pages set `site` and `base` (see .github/workflows/deploy.yml).
export default defineConfig({
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH,
  vite: {
    // The Markdown decoder's browser entry needs `document`; its worker entry uses a pure lookup.
    resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] },
  },
  // The first guides were split into sections; keep their old addresses working.
  redirects: {
    '/guides/writing-diagrams': `${base}/format/overview/`,
    '/guides/scenarios': `${base}/scenarios/overview/`,
    '/guides/icons-and-theming': `${base}/customize/icons/`,
    '/guides/ai-authoring': `${base}/ai/skill/`,
  },
  integrations: [
    idocs(),
    react(),
    starlight({
      title: 'idocs',
      description: 'Architecture diagrams you can click, filter and play.',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        alt: '',
      },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/apps/docs/` },
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0a6f8f' } },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' },
        },
        ...(image
          ? [
              { tag: 'meta', attrs: { property: 'og:image', content: image } },
              { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
            ]
          : []),
      ],
      components: { Footer: './src/components/DocsFooter.astro' },
      expressiveCode: {
        styleOverrides: {
          borderRadius: '0.5rem',
          // Lines a step adds to a file are marked in the brand teal instead of diff green.
          textMarkers: {
            insBackground: { dark: '#55bcdb26', light: '#0a6f8f1f' },
            insBorderColor: { dark: '#55bcdb', light: '#0a6f8f' },
            insDiffIndicatorColor: { dark: '#55bcdb', light: '#0a6f8f' },
          },
        },
      },
      customCss: [
        '@fontsource/ibm-plex-sans/400.css',
        '@fontsource/ibm-plex-sans/500.css',
        '@fontsource/ibm-plex-sans/600.css',
        '@fontsource/ibm-plex-sans-condensed/600.css',
        '@fontsource/ibm-plex-mono/400.css',
        '@fontsource/ibm-plex-mono/500.css',
        '@the-package-labs/idocs-astro/starlight.css',
        './src/styles/palettes.css',
        './src/styles/custom.css',
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { slug: 'guides/introduction' },
            { slug: 'guides/getting-started' },
            { slug: 'guides/project-structure' },
            { slug: 'guides/first-diagram' },
            { slug: 'guides/editor' },
            { label: 'Playground', link: `${base}/playground/` },
          ],
        },
        {
          label: 'Diagram format',
          items: [
            { slug: 'format/overview' },
            { slug: 'format/nodes' },
            { slug: 'format/entities' },
            { slug: 'format/groups' },
            { slug: 'format/edges' },
            { slug: 'format/views' },
            { slug: 'format/defaults' },
            { slug: 'format/nested-diagrams' },
            { slug: 'format/kinds' },
            { slug: 'format/node-docs' },
          ],
        },
        {
          label: 'Scenarios',
          items: [
            { slug: 'scenarios/overview' },
            { slug: 'scenarios/steps' },
            { slug: 'scenarios/phases' },
            { slug: 'scenarios/parallel-and-routes' },
            { slug: 'scenarios/story-view' },
            { slug: 'scenarios/sequence-view' },
            { slug: 'scenarios/playback' },
          ],
        },
        {
          label: 'Layout',
          collapsed: true,
          items: [
            { slug: 'layout/how-it-works' },
            { slug: 'layout/hints' },
            { slug: 'layout/fixing-layouts' },
          ],
        },
        {
          label: 'Customize',
          collapsed: true,
          items: [
            { slug: 'customize/icons' },
            { slug: 'customize/theming' },
            { slug: 'customize/colours' },
            { slug: 'customize/commands' },
          ],
        },
        {
          label: 'Embed and publish',
          collapsed: true,
          items: [
            { slug: 'embed/diagram-component' },
            { slug: 'embed/existing-site' },
            { slug: 'embed/publishing' },
            { slug: 'embed/react' },
          ],
        },
        {
          label: 'AI agents',
          collapsed: true,
          items: [{ slug: 'ai/skill' }, { slug: 'ai/workflow' }],
        },
        {
          label: 'Examples',
          items: [
            { slug: 'examples/checkout' },
            { slug: 'examples/platform' },
            { slug: 'examples/payments' },
          ],
        },
        {
          label: 'Reference',
          collapsed: true,
          items: [
            { slug: 'reference/schema' },
            { slug: 'reference/cli' },
            { slug: 'reference/props' },
            { slug: 'reference/packages' },
            { slug: 'reference/errors' },
            { slug: 'reference/interaction' },
          ],
        },
        {
          label: 'Project',
          collapsed: true,
          items: [
            { slug: 'project/architecture' },
            { slug: 'project/roadmap' },
            { slug: 'project/contributing' },
            { slug: 'project/faq' },
          ],
        },
      ],
    }),
  ],
})
