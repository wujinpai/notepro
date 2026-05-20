import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function SearchPanel() {
  const { searchPosts, dispatch } = useApp();
  const [query, setQuery] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!query.trim()) return;
    searchPosts(query.trim());
    dispatch({ type: 'SHOW_TOOLS', payload: false });
  }

  return (
    <div className="search-panel">
      <form className="search-form" onSubmit={handleSubmit}>
        <i className="icon-search search-icon" />
        <input
          className="search-input"
          type="text"
          placeholder="搜索文章..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="search-submit" type="submit">
          搜索
        </button>
      </form>
    </div>
  );
}
