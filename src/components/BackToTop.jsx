import { useState, useEffect } from 'react';
import { scrollToTop } from '../utils/helpers';

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 300);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <button className="back-to-top" onClick={() => scrollToTop()} title="回到顶部">
      <i className="icon-chevron-up" />
    </button>
  );
}
