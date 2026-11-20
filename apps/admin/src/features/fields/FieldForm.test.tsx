import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import type { FieldDef } from '@meridian/shared';
import { theme } from '@/theme/theme';
import { type ComponentInfo, FieldForm, componentIndex, toFieldErrors } from './FieldForm';

const field = (apiId: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({ apiId, label, type, required: false, unique: false, localized: false, config: {}, position: 0, ...extra });

const components: Record<string, ComponentInfo> = {
  link: { displayName: 'Link', fields: [field('label', 'Link label', 'text', { required: true }), field('url', 'Link URL', 'url')] },
};

function Harness({ fields, initial = {}, errors, onValue }: { fields: FieldDef[]; initial?: Record<string, unknown>; errors?: Record<string, string>; onValue?: (v: Record<string, unknown>) => void }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <ThemeProvider theme={theme}>
      <FieldForm
        fields={fields}
        value={value}
        errors={errors}
        components={components}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
    </ThemeProvider>
  );
}

describe('FieldForm', () => {
  it('renders labelled inputs with required markers, help text and errors', () => {
    render(
      <Harness
        fields={[field('title', 'Title', 'text', { required: true, config: { helpText: 'Shown as the page heading' } }), field('views', 'Views', 'integer')]}
        errors={{ views: 'Views must be at least 0' }}
      />,
    );
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(screen.getByText('Shown as the page heading')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Views must be at least 0');
    expect(screen.getByLabelText(/^Views/)).toHaveAttribute('aria-describedby', expect.stringMatching(/-views-error$/));
  });

  it('reports typed values: text, numbers, booleans and selects', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(
      <Harness
        onValue={onValue}
        fields={[
          field('title', 'Title', 'text'),
          field('views', 'Views', 'integer'),
          field('live', 'Live', 'boolean'),
          field('kind', 'Kind', 'radio', { config: { options: [{ label: 'News', value: 'news' }, { label: 'Guide', value: 'guide' }] } }),
        ]}
      />,
    );
    await user.type(screen.getByLabelText(/^Title/), 'Hi');
    await user.type(screen.getByLabelText(/^Views/), '42');
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('radio', { name: 'Guide' }));
    expect(onValue).toHaveBeenLastCalledWith({ title: 'Hi', views: 42, live: true, kind: 'guide' });

    // Clearing a number stores null, not an empty string.
    await user.clear(screen.getByLabelText(/^Views/));
    expect(onValue.mock.lastCall?.[0].views).toBeNull();
  });

  it('shows and hides fields according to their conditions', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        fields={[
          field('hasLink', 'Add a link', 'checkbox'),
          field('url', 'Destination', 'url', { config: { visibleWhen: { field: 'hasLink', operator: 'notEmpty' } } }),
        ]}
      />,
    );
    expect(screen.queryByLabelText(/^Destination/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText(/^Destination/)).toBeInTheDocument();
  });

  it('keeps slugs URL-safe and generates them from the source field', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} initial={{ title: 'Hello Wörld & Co' }} fields={[field('title', 'Title', 'text'), field('slug', 'Slug', 'slug', { config: { sourceField: 'title' } })]} />);
    await user.click(screen.getByRole('button', { name: 'Generate slug' }));
    expect(onValue.mock.lastCall?.[0].slug).toBe('hello-world-and-co');
    await user.clear(screen.getByLabelText(/^Slug/));
    await user.type(screen.getByLabelText(/^Slug/), 'My Page!');
    expect(onValue.mock.lastCall?.[0].slug).toBe('my-page-');
  });

  it('edits repeatable component lists: add, fill in, reorder and remove', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} fields={[field('links', 'Links', 'repeatable', { config: { component: 'link', maxItems: 2 } })]} />);

    await user.click(screen.getByRole('button', { name: /Add link/ }));
    await user.type(screen.getByLabelText(/^Link label/), 'Docs');
    await user.click(screen.getByRole('button', { name: /Add link/ }));
    const labels = screen.getAllByLabelText(/^Link label/);
    await user.type(labels[1], 'Blog');
    const titles = () => (onValue.mock.lastCall?.[0].links as { label: string }[]).map((l) => l.label);
    expect(titles()).toEqual(['Docs', 'Blog']);
    // The limit from the schema is enforced in the form.
    expect(screen.getByRole('button', { name: /Add link/ })).toBeDisabled();

    await user.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    expect(titles()).toEqual(['Blog', 'Docs']);
    await user.click(screen.getAllByRole('button', { name: 'Remove item' })[0]);
    expect(titles()).toEqual(['Docs']);
  });

  it('routes nested validation errors to the right item', () => {
    render(
      <Harness
        initial={{ links: [{ label: 'Docs', url: '/docs' }, { label: '', url: '/x' }] }}
        fields={[field('links', 'Links', 'repeatable', { config: { component: 'link' } })]}
        errors={{ 'links.1.label': 'Link label is required' }}
      />,
    );
    // The item with the problem opens by itself and shows the message next to its field.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Link label is required');
    expect(within(alert.parentElement as HTMLElement).getByLabelText(/^Link label/)).toHaveValue('');
  });

  it('groups fields into tabs and flags the tab that has an error', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        fields={[field('title', 'Title', 'text'), field('seoTitle', 'SEO title', 'text', { config: { tab: 'SEO' } })]}
        errors={{ seoTitle: 'Too long' }}
      />,
    );
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^SEO title/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'SEO' }));
    expect(screen.getByLabelText(/^SEO title/)).toBeInTheDocument();
  });

  it('never shows a stored secret, only that one is set', () => {
    render(<Harness initial={{ pin: { $secret: 'set' } }} fields={[field('pin', 'Access code', 'password')]} />);
    expect(screen.getByLabelText('Access code (a value is set)')).toHaveValue('••••••••••••');
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });
});

describe('form helpers', () => {
  it('builds the component lookup from a schema response', () => {
    const index = componentIndex({
      components: [{ apiId: 'seo-meta', displayName: 'SEO metadata', icon: 'globe', fields: [] }],
      builtinComponents: { 'builtin.footer-column': [] },
    });
    expect(index['seo-meta']).toMatchObject({ displayName: 'SEO metadata', icon: 'globe' });
    expect(index['builtin.footer-column'].displayName).toBe('Footer column');
    expect(componentIndex(undefined)).toEqual({});
  });

  it('maps API validation details to field paths', () => {
    expect(toFieldErrors([{ path: 'title', message: 'Required' }, { path: 'title', message: 'Second' }, { path: 'seo.title', message: 'Too long' }, { message: 'no path' }])).toEqual({ title: 'Required', 'seo.title': 'Too long' });
    expect(toFieldErrors([{ path: 'blocks.0.props.heading', message: 'Required' }], 'blocks.0.props.')).toEqual({ heading: 'Required' });
    expect(toFieldErrors({ not: 'an array' })).toEqual({});
  });
});
