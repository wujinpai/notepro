import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { getDaysInMonth, getFirstDayOfWeek } from '../utils/helpers';
import * as api from '../utils/api';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

export default function Calendar() {
  const { filterByDate } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [postCounts, setPostCounts] = useState({});

  const loadCalendar = useCallback(async () => {
    try {
      const data = await api.calendar.month(year, month);
      const cal = data.calendar || data || {};
      const counts = {};
      for (const [key, val] of Object.entries(cal)) {
        counts[parseInt(key, 10)] = typeof val === 'number' ? val : 1;
      }
      setPostCounts(counts);
    } catch {
      setPostCounts({});
    }
  }, [year, month]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  function handleDayClick(day) {
    if (!postCounts[day]) return;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    filterByDate(dateStr);
  }

  function prevMonth() {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="calendar-panel">
      <div className="calendar-header">
        <button className="calendar-nav-btn" onClick={prevMonth}>
          <i className="icon-chevron-left" />
        </button>
        <div className="calendar-title">
          <select className="calendar-year-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, i) => now.getFullYear() - 5 + i).map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <select className="calendar-month-select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <button className="calendar-nav-btn" onClick={nextMonth}>
          <i className="icon-chevron-right" />
        </button>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map((d) => (
          <div className="calendar-weekday" key={d}>{d}</div>
        ))}
        {blanks.map((b) => (
          <div className="calendar-day calendar-day-blank" key={`blank-${b}`} />
        ))}
        {days.map((day) => {
          const count = postCounts[day] || 0;
          const isToday = day === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
          return (
            <div
              className={`calendar-day${count > 0 ? ' calendar-day-has-posts' : ''}${isToday ? ' calendar-day-today' : ''}`}
              key={day}
              onClick={() => handleDayClick(day)}
            >
              <span className="calendar-day-num">{day}</span>
              {count > 0 && <span className="calendar-day-count">{count}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
