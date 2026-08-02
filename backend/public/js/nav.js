const navToggle = document.getElementById('nav-toggle');
const navEl = document.getElementById('nav');
const navLinks = document.querySelectorAll('.nav-link');
const pages = document.querySelectorAll('.page');
const viewButtons = document.querySelectorAll('.view-btn');
const viewPanels = document.querySelectorAll('.view-panel');

export function initNav({ onShowReportPage, onShowHomePage, onShowMapView }) {
  navToggle.addEventListener('click', () => {
    const isOpen = navEl.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  function showPage(name) {
    pages.forEach(p => p.classList.remove('active'));
    navLinks.forEach(l => l.classList.remove('active'));
    const target = document.getElementById(`page-${name}`);
    const link = document.querySelector(`.nav-link[data-page="${name}"]`);
    if (target) target.classList.add('active');
    if (link) link.classList.add('active');
    navEl.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    if (name === 'report') onShowReportPage();
    if (name === 'home') onShowHomePage();
  }

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      // pushState so the browser back button navigates between pages
      history.pushState({ page }, '', `#${page}`);
      showPage(page);
    });
  });

  viewButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      viewButtons.forEach(b => b.classList.remove('active'));
      viewPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.view}-view`).classList.add('active');
      if (btn.dataset.view === 'map') onShowMapView();
    });
  });

  // Handle browser back/forward navigation
  window.addEventListener('popstate', (e) => {
    const page = (e.state && e.state.page) || location.hash.replace('#', '') || 'home';
    showPage(page);
  });

  window.addEventListener('load', () => {
    const initial = location.hash.replace('#', '') || 'home';
    // Replace the initial entry so pressing back from page 1 exits the app
    history.replaceState({ page: initial }, '', `#${initial}`);
    showPage(initial);
  });
}
