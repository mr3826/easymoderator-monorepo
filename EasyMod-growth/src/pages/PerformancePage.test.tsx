import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PerformancePage } from './PerformancePage';

vi.mock('./AnalyticsPage', () => ({
  AnalyticsPage: ({ embedded = false }: { embedded?: boolean }) => (
    <div>Analytics content{embedded ? ' embedded' : ' standalone'}</div>
  ),
}));
vi.mock('./SourcesPage', () => ({
  SourcesPage: ({ embedded = false }: { embedded?: boolean } = {}) => (
    <div>Sources content{embedded ? ' embedded' : ' standalone'}</div>
  ),
}));

function renderPage(path = '/performance') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PerformancePage />
    </MemoryRouter>,
  );
}

describe('PerformancePage', () => {
  it('shows the funnel view embedded by default', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Growth Performance' })).toBeInTheDocument();
    expect(screen.getByText('Analytics content embedded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Funnel/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to source attribution via tab and URL parameter', async () => {
    renderPage();
    await screen.findByText('Analytics content embedded');

    await userEvent.setup().click(screen.getByRole('button', { name: /Source attribution/ }));
    expect(screen.getByText('Sources content embedded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Source attribution/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('deep-links directly to the sources tab', async () => {
    renderPage('/performance?tab=sources');
    expect(await screen.findByText('Sources content embedded')).toBeInTheDocument();
  });
});
