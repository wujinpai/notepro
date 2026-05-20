import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function TagsPanel() {
  const { state, filterByTag, dispatch } = useApp();
  const [search, setSearch] = useState('');
  const tags = state.tags || [];

  const filtered = search.trim()
    ? tags.filter((t) => {
        const name = typeof t === 'string' ? t : t.name || '';
        return name.toLowerCase().includes(search.toLowerCase());
      })
    : tags;

  function handleTagClick(tag) {
    const name = typeof tag === 'string' ? tag : tag.name;
    filterByTag(name);
    dispatch({ type: 'SHOW_TOOLS', payload: false });
  }

  function handleClearFilter() {
    filterByTag(null);
    dispatch({ type: 'SHOW_TOOLS', payload: false });
  }

  return (
    <div className="tags-panel">
      <div className="tags-search">
        <i className="icon-search" />
        <input
          className="tags-search-input"
          type="text"
          placeholder="搜索标签..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="tags-list">
        <button
          className={`tags-item${!state.currentTag ? ' active' : ''}`}
          onClick={handleClearFilter}
        >
          全部
        </button>
        {filtered.map((tag, i) => {
          const name = typeof tag === 'string' ? tag : tag.name;
          const count = typeof tag === 'object' ? tag.count : undefined;
          return (
            <button
              key={i}
              className={`tags-item${state.currentTag === name ? ' active' : ''}`}
              onClick={() => handleTagClick(tag)}
            >
              {name}
              {count != null && <span className="tags-count">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
