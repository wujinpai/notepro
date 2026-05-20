import { useState, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { renderMarkdown } from '../utils/markdown';
import { formatDate, buildMediaGrid } from '../utils/helpers';
import * as api from '../utils/api';

export default function PostCard({ post }) {
  const { state, dispatch, toast, openLightbox } = useApp();
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef(null);

  const isHidden = post.isHidden;
  const isPinned = post.isPinned;

  const handleImageClick = useCallback((e, src, alt) => {
    e.stopPropagation();
    const images = (post.media || []).map((m) => (typeof m === 'string' ? m : m.url || m.src));
    const idx = images.indexOf(src);
    openLightbox(images.length > 0 ? images : [src], idx >= 0 ? idx : 0);
  }, [post.media, openLightbox]);

  function handleEdit() {
    dispatch({ type: 'SHOW_EDITOR', payload: true, post });
  }

  async function handleDelete() {
    if (!confirm('确定删除此文章？')) return;
    try {
      await api.posts.delete(post.id);
      toast('文章已删除', 'success');
    } catch {
      toast('删除失败', 'error');
    }
  }

  function handleReadMore(e) {
    e.stopPropagation();
    setExpanded(true);
  }

  const mediaGrid = buildMediaGrid(post.media || []);

  const htmlContent = renderMarkdown(post.content);

  return (
    <article className={`post-card${isHidden ? ' post-card-hidden' : ''}${isPinned ? ' post-card-pinned' : ''}`}>
      {isPinned && (
        <div className="post-card-pin">
          <i className="icon-pin" />
        </div>
      )}
      <div className="post-card-header">
        <h2 className="post-card-title">{post.title}</h2>
        <div className="post-card-meta">
          {post.tag && (
            <span className="post-card-tag" style={{ backgroundColor: `var(--TAG_COLOR)` }}>
              {post.tag}
            </span>
          )}
          <span className="post-card-date">
            <i className="icon-clock" /> {formatDate(post.createdAt || post.date)}
          </span>
          {post.weather != null && (
            <span className="post-card-weather">
              <i className={`icon-weather-${post.weather}`} />
            </span>
          )}
          {post.location && (
            <span className="post-card-location">
              <i className="icon-location" /> {post.location}
            </span>
          )}
        </div>
      </div>
      <div
        className={`post-card-content${expanded ? ' post-card-content-expanded' : ''}`}
        ref={contentRef}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
        onClick={(e) => {
          const img = e.target.closest('img');
          if (img) handleImageClick(e, img.src, img.alt);
        }}
      />
      {!expanded && (
        <div className="post-card-readmore" onClick={handleReadMore}>
          阅读全文
        </div>
      )}
      {mediaGrid.length > 0 && (
        <div className="post-card-media">
          {mediaGrid.map((row, ri) => (
            <div className="post-card-media-row" key={ri}>
              {row.map((media, mi) => {
                const src = typeof media === 'string' ? media : media.url || media.src || '';
                const alt = typeof media === 'string' ? '' : media.alt || '';
                return (
                  <div className="post-card-media-item" key={mi} onClick={(e) => handleImageClick(e, src, alt)}>
                    <img src={src} alt={alt} loading="lazy" />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {state.isLoggedIn && (
        <div className="post-card-actions">
          <button onClick={handleEdit} title="编辑">
            <i className="icon-edit" />
          </button>
          <button onClick={handleDelete} title="删除">
            <i className="icon-trash" />
          </button>
        </div>
      )}
    </article>
  );
}
