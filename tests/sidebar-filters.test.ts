import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Sidebar from '../src/components/Sidebar'
import { reconcileActiveFilter } from '../src/lib/sidebar-filters'

describe('sidebar active filter recovery', () => {
  it('clears selected tag or source when no remaining items carry it', () => {
    expect(reconcileActiveFilter('临时标签', ['工作', '常用'])).toBeNull()
    expect(reconcileActiveFilter('临时标签', [])).toBeNull()
    expect(reconcileActiveFilter('工作', ['工作', '常用'])).toBe('工作')
    expect(reconcileActiveFilter(null, ['工作'])).toBeNull()
  })

  it('shows reset-filters button and keeps active tag bar visible when filtered list is empty', () => {
    const noop = () => {}
    const filteredEmpty = renderToStaticMarkup(
      createElement(Sidebar, {
        items: [],
        selectedId: null,
        searchQuery: '',
        onSearchChange: noop,
        onSelect: noop,
        density: 'comfortable',
        activeTab: 'history',
        onTabChange: noop,
        allTags: [],
        selectedTag: '临时标签',
        onTagChange: noop,
        allSources: [],
        selectedSource: null,
        onSourceChange: noop,
        onResetFilters: noop,
        onReorder: noop,
        onVaultReorder: noop,
        typeFilter: 'all',
        onTypeFilterChange: noop,
      }),
    )
    expect(filteredEmpty).toContain('data-testid="tag-filter-bar"')
    expect(filteredEmpty).toContain('临时标签')
    expect(filteredEmpty).toContain('data-testid="sidebar-reset-filters"')

    const unfilteredEmpty = renderToStaticMarkup(
      createElement(Sidebar, {
        items: [],
        selectedId: null,
        searchQuery: '',
        onSearchChange: noop,
        onSelect: noop,
        density: 'comfortable',
        activeTab: 'history',
        onTabChange: noop,
        allTags: [],
        selectedTag: null,
        onTagChange: noop,
        allSources: [],
        selectedSource: null,
        onSourceChange: noop,
        onResetFilters: noop,
        onReorder: noop,
        onVaultReorder: noop,
        typeFilter: 'all',
        onTypeFilterChange: noop,
      }),
    )
    expect(unfilteredEmpty).not.toContain('data-testid="sidebar-reset-filters"')
  })
})
