import { useApp } from '../context/AppContext';
import Calendar from './Calendar';
import TagsPanel from './TagsPanel';
import SearchPanel from './SearchPanel';

export default function ToolsPanel() {
  const { state, dispatch } = useApp();
  const { toolsType } = state;

  function handleClose() {
    dispatch({ type: 'SHOW_TOOLS', payload: false });
  }

  function switchTool(type) {
    dispatch({ type: 'SHOW_TOOLS', payload: true, toolsType: type });
  }

  return (
    <div className="tools-overlay" onClick={handleClose}>
      <div className="tools-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tools-header">
          <div className="tools-tabs">
            <button
              className={`tools-tab${toolsType === 'tags' ? ' active' : ''}`}
              onClick={() => switchTool('tags')}
            >
              <i className="icon-tags" /> 标签
            </button>
            <button
              className={`tools-tab${toolsType === 'calendar' ? ' active' : ''}`}
              onClick={() => switchTool('calendar')}
            >
              <i className="icon-calendar" /> 日历
            </button>
            <button
              className={`tools-tab${toolsType === 'search' ? ' active' : ''}`}
              onClick={() => switchTool('search')}
            >
              <i className="icon-search" /> 搜索
            </button>
          </div>
          <button className="tools-close" onClick={handleClose}>
            <i className="icon-close" />
          </button>
        </div>
        <div className="tools-body">
          {toolsType === 'tags' && <TagsPanel />}
          {toolsType === 'calendar' && <Calendar />}
          {toolsType === 'search' && <SearchPanel />}
        </div>
      </div>
    </div>
  );
}
