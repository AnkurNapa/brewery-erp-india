// One line-icon set for the whole app: 24 px grid, 1.7 stroke, round caps, SF Symbols in spirit.
// Every navigation entry has an icon here, so the sidebar and the phone tab bar always match.
export const ICON = {
  dash: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4"/><path d="M12 17h.01"/>',
  tanks: '<path d="M7 3h10v12l-5 6-5-6z"/><path d="M7 9h10"/>',
  batches: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V3h5v1M9 10h6M9 14h6M9 18h3"/>',
  recipes: '<path d="M9.5 3h5M10.5 3v6l-5 8.6A2 2 0 0 0 7.2 21h9.6a2 2 0 0 0 1.7-3.4l-5-8.6V3"/><path d="M7.6 15h8.8"/>',
  packaging: '<rect x="7" y="3.5" width="10" height="17" rx="2.5"/><path d="M7 8h10M7 16h10"/>',
  materials: '<path d="M4 8l8-4 8 4v8.5L12 21l-8-4.5z"/><path d="M4 8l8 4.5L20 8M12 12.5V21"/>',
  purchasing: '<path d="M3 4h2l2.4 11h10.2L20 8H6.1"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  equipment: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2v2h-2zM18 14h2M14 19h2"/>',
  cip: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/><path d="M9.3 14.6a2.8 2.8 0 0 0 2.7 2.6"/>',
  losses: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  stocktake: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M8.5 9.5l1.5 1.5 2.8-3M8.5 15.5l1.5 1.5 2.8-3M15.5 10h.5M15.5 16h.5"/>',
  sales: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  kegs: '<path d="M7.5 3h9l1.5 3.5v11L16.5 21h-9L6 17.5v-11z"/><path d="M6 8.5h12M6 15.5h12"/>',
  dispatch: '<path d="M3 6.5h11v9.5H3zM14 9.5h3.8l3.2 3.3V16h-7"/><circle cx="7" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/>',
  menu: '<path d="M7 4h10l-1.6 16H8.6z"/><path d="M7.4 8.5h9.2"/>',
  partners: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.2" r="2.4"/><path d="M15.6 14.3A4.5 4.5 0 0 1 21 18.6"/>',
  records: '<path d="M13 3L5.5 13H11l-1 8 7.5-10H12z"/>',
  reports: '<path d="M4 20h16M7 16.5v-5M12 16.5V7M17 16.5v-8"/>',
  tax: '<path d="M7 5h10M7 9h10M7 5c5.2 0 6.2 2 6.2 4s-2 4-6.2 4l6.8 6.5"/>',
  setup: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--icon-bg, #fff)"/><circle cx="15" cy="12" r="2" fill="var(--icon-bg, #fff)"/><circle cx="8" cy="17" r="2" fill="var(--icon-bg, #fff)"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M5.6 18.4l1.9-1.9M16.5 7.5l1.9-1.9"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};

export const icon = (k, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
