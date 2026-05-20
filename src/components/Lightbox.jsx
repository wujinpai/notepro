import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';

export default function Lightbox() {
  const { state, closeLightbox } = useApp();
  const { lightbox } = state;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (lightbox) {
      setCurrentIndex(lightbox.index || 0);
    }
  }, [lightbox]);

  const handlePrev = useCallback(() => {
    if (!lightbox) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : lightbox.images.length - 1));
  }, [lightbox]);

  const handleNext = useCallback(() => {
    if (!lightbox) return;
    setCurrentIndex((prev) => (prev < lightbox.images.length - 1 ? prev + 1 : 0));
  }, [lightbox]);

  useEffect(() => {
    function handleKey(e) {
      if (!lightbox) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightbox, closeLightbox, handlePrev, handleNext]);

  if (!lightbox) return null;

  const images = lightbox.images || [];
  const current = images[currentIndex];

  return (
    <div className="lightbox-overlay" onClick={closeLightbox}>
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-toolbar">
          <span className="lightbox-counter">{currentIndex + 1} / {images.length}</span>
          <button className="lightbox-btn" onClick={() => setShowInfo(!showInfo)} title="信息">
            <i className="icon-info" />
          </button>
          <button className="lightbox-btn" onClick={closeLightbox} title="关闭">
            <i className="icon-close" />
          </button>
        </div>
        <div className="lightbox-image-wrap">
          {images.length > 1 && (
            <button className="lightbox-nav lightbox-prev" onClick={handlePrev}>
              <i className="icon-chevron-left" />
            </button>
          )}
          <img className="lightbox-image" src={current} alt="" />
          {images.length > 1 && (
            <button className="lightbox-nav lightbox-next" onClick={handleNext}>
              <i className="icon-chevron-right" />
            </button>
          )}
        </div>
        {showInfo && (
          <div className="lightbox-info">
            <p>URL: {current}</p>
            <p>索引: {currentIndex + 1} / {images.length}</p>
          </div>
        )}
      </div>
    </div>
  );
}
