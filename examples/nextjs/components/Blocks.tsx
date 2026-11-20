import type { CSSProperties, ReactNode } from 'react';
import type { Block, MediaAsset } from '@meridian/sdk';
import { imageUrl } from '@meridian/sdk';

/**
 * Meridian pages are framework-neutral data. This file is the only place that decides
 * how each block type looks in THIS application — swap in your design system freely.
 */

type BlockProps<P = Record<string, any>> = P & { blockStyle?: Record<string, any>; children?: ReactNode };

const WIDTHS: Record<string, number | string> = { sm: 640, md: 768, lg: 1024, xl: 1280, full: '100%' };

/** Translates the editor's style settings into CSS. */
function frame(style: Record<string, any> = {}): { outer: CSSProperties; inner: CSSProperties } {
  const bg = style.background ?? {};
  return {
    outer: {
      backgroundColor: bg.color,
      backgroundImage: bg.image ? `url(${imageUrl(bg.image as MediaAsset, { w: 1920, format: 'webp' })})` : undefined,
      backgroundSize: 'cover',
      color: style.textColor,
      textAlign: style.align,
      paddingTop: style.padding?.top,
      paddingBottom: style.padding?.bottom,
      paddingLeft: style.padding?.left ?? 24,
      paddingRight: style.padding?.right ?? 24,
      marginTop: style.margin?.top,
      marginBottom: style.margin?.bottom,
      border: style.border?.width ? `${style.border.width}px solid ${style.border.color ?? 'currentColor'}` : undefined,
      borderRadius: style.border?.radius,
    },
    inner: { maxWidth: WIDTHS[style.maxWidth ?? 'lg'], margin: '0 auto' },
  };
}

function Section({ blockStyle, children, id }: { blockStyle?: Record<string, any>; children: ReactNode; id?: string }) {
  const { outer, inner } = frame(blockStyle);
  return (
    <section id={blockStyle?.anchor ?? id} style={outer} className={blockStyle?.cssClass}>
      <div style={inner}>{children}</div>
    </section>
  );
}

function Hero({ eyebrow, heading, subheading, image, primaryLabel, primaryUrl, secondaryLabel, secondaryUrl, blockStyle }: BlockProps) {
  return (
    <Section blockStyle={blockStyle}>
      {eyebrow && <p>{eyebrow}</p>}
      <h1>{heading}</h1>
      {subheading && <p>{subheading}</p>}
      {primaryLabel && <a href={primaryUrl}>{primaryLabel}</a>} {secondaryLabel && <a href={secondaryUrl}>{secondaryLabel}</a>}
      {image && <img src={imageUrl(image, { w: 1600, format: 'webp' })} alt={image.alt} width={image.width ?? undefined} height={image.height ?? undefined} />}
    </Section>
  );
}

/** Rich text arrives as sanitized HTML when the page is fetched with `richtext: 'html'`. */
function RichText({ content, blockStyle }: BlockProps<{ content: string }>) {
  return (
    <Section blockStyle={blockStyle}>
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </Section>
  );
}

function FeatureGrid({ heading, subheading, items = [], blockStyle }: BlockProps) {
  return (
    <Section blockStyle={blockStyle}>
      {heading && <h2>{heading}</h2>}
      {subheading && <p>{subheading}</p>}
      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: `repeat(${blockStyle?.columns?.desktop ?? 3}, minmax(0, 1fr))` }}>
        {items.map((item: { title: string; description?: string }, i: number) => (
          <div key={i}>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Faq({ heading, items = [], blockStyle }: BlockProps) {
  return (
    <Section blockStyle={blockStyle}>
      {heading && <h2>{heading}</h2>}
      {items.map((item: { question: string; answer: string }, i: number) => (
        <details key={i}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </Section>
  );
}

function Cta({ heading, body, primaryLabel, primaryUrl, blockStyle }: BlockProps) {
  return (
    <Section blockStyle={blockStyle}>
      <h2>{heading}</h2>
      {body && <p>{body}</p>}
      {primaryLabel && <a href={primaryUrl}>{primaryLabel}</a>}
    </Section>
  );
}

function Container({ children, blockStyle }: BlockProps) {
  return <Section blockStyle={blockStyle}>{children}</Section>;
}

function Columns({ children, blockStyle }: BlockProps) {
  return (
    <Section blockStyle={blockStyle}>
      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: `repeat(${blockStyle?.columns?.desktop ?? 2}, minmax(0, 1fr))` }}>{children}</div>
    </Section>
  );
}

/** Register a component per block type. Types without a component are skipped, never a crash. */
const registry: Record<string, (props: BlockProps<any>) => ReactNode> = {
  section: Container,
  columns: Columns,
  hero: Hero,
  text: RichText,
  'feature-grid': FeatureGrid,
  faq: Faq,
  cta: Cta,
  // image, video, split, cards, testimonials, pricing, stats, logos, gallery, contact, team,
  // blog-listing, product-listing, breadcrumbs, navigation, footer, html, json and your own
  // custom components are added the same way.
};

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block) => {
        const Component = registry[block.type];
        if (!Component) return null;
        return (
          <Component key={block.id} {...block.props} blockStyle={block.style}>
            {block.children?.length ? <Blocks blocks={block.children} /> : null}
          </Component>
        );
      })}
    </>
  );
}
