import { useApp } from '../context/AppContext';
import { formatDate } from '../utils/helpers';

export default function Navbar() {
  const { state, dispatch } = useApp();
  const { currentDate, currentTag, searchQuery, isLoggedIn } = state;

  function openTools(type) {
    dispatch({ type: 'SHOW_TOOLS', payload: true, toolsType: type });
  }

  function handleNewPost() {
    dispatch({ type: 'SHOW_EDITOR', payload: true, post: null });
  }

  function clearFilters() {
    dispatch({ type: 'SET_CURRENT_TAG', payload: null });
    dispatch({ type: 'SET_CURRENT_DATE', payload: null });
    dispatch({ type: 'SET_SEARCH_QUERY', payload: '' });
  }

  const hasFilter = currentTag || currentDate || searchQuery;

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-tools">
          <button className="navbar-btn" onClick={() => openTools('tags')} title="标签">
            <i className="icon-tags" />
            <span className="navbar-btn-label">标签</span>
          </button>
          <button className="navbar-btn" onClick={() => openTools('calendar')} title="日历">
            <i className="icon-calendar" />
            <span className="navbar-btn-label">日历</span>
          </button>
          <button className="navbar-btn" onClick={() => openTools('search')} title="搜索">
            <i className="icon-search" />
            <span className="navbar-btn-label">搜索</span>
          </button>
        </div>
        <div className="navbar-info">
          {currentDate && (
            <span className="navbar-filter-tag">
              <i className="icon-calendar" /> {formatDate(currentDate)}
            </span>
          )}
          {currentTag && (
            <span className="navbar-filter-tag">
              <i className="icon-tag" /> {currentTag}
            </span>
          )}
          {searchQuery && (
            <span className="navbar-filter-tag">
              <i className="icon-search" /> {searchQuery}
            </span>
          )}
          {hasFilter && (
            <button className="navbar-clear" onClick={clearFilters} title="清除筛选">
              <i className="icon-close" />
            </button>
          )}
        </div>
        {isLoggedIn && (
          <div className="navbar-actions">
            <button className="navbar-btn navbar-btn-primary" onClick={handleNewPost} title="写文章">
              <i className="icon-edit" />
              <span className="navbar-btn-label">写文章</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
