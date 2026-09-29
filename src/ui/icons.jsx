const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export const IconSound = () => (
  <svg {...base}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></svg>
);

export const IconMute = () => (
  <svg {...base}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>
);

export const IconClose = () => (
  <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);

export const IconAssist = () => (
  <svg {...base}><circle cx="5" cy="17" r="2" /><path d="M7 15.5C10 10 14 7 20 6" strokeDasharray="2 3" /><path d="M17 4l3 2-2 3" /></svg>
);

export const IconCopy = () => (
  <svg {...base}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
);

export const IconShare = () => (
  <svg {...base}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" /></svg>
);
