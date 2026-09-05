(() => {
  'use strict';

  const nav = document.querySelector('#main-nav');
  const menuToggle = document.querySelector('.menu-toggle');
  const cleanButton = document.querySelector('#clean-demo');
  const cleanLabel = document.querySelector('#clean-demo-label');
  const demoAddress = document.querySelector('#demo-address');
  const demoAfter = document.querySelector('#demo-after code');
  const demoStatus = document.querySelector('#demo-status');
  const removedChips = document.querySelector('#removed-chips');
  const copyButton = document.querySelector('#copy-demo');
  const year = document.querySelector('#current-year');
  const navBar = document.querySelector('.site-nav');

  const demo = {
    dirty: 'shop.example.tw/item?utm_source=ig&igsh=demo123&keep=blue#spec',
    clean: 'shop.example.tw/item?keep=blue#spec',
    removed: ['utm_source', 'igsh']
  };
  let isCleaned = true;

  function renderDemo() {
    const current = isCleaned ? demo.clean : demo.dirty;
    demoAddress.textContent = current;
    demoAfter.textContent = isCleaned ? '?keep=blue#spec' : '尚未整理';
    cleanLabel.textContent = isCleaned ? '還原示範' : '清理網址';
    demoStatus.textContent = isCleaned ? '清理完成，不重新載入頁面' : '這是帶有追蹤參數的原始網址';
    cleanButton.classList.toggle('is-cleaned', isCleaned);
    removedChips.replaceChildren();
    if (isCleaned) {
      for (const name of demo.removed) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = name;
        removedChips.appendChild(chip);
      }
    } else {
      const empty = document.createElement('span');
      empty.className = 'chip';
      empty.style.borderColor = 'rgba(156, 174, 193, .25)';
      empty.style.background = 'rgba(156, 174, 193, .06)';
      empty.style.color = '#9caec1';
      empty.textContent = '等待清理';
      removedChips.appendChild(empty);
    }
  }

  async function copyDemoUrl() {
    const value = `https://${isCleaned ? demo.clean : demo.dirty}`;
    try {
      await navigator.clipboard.writeText(value);
      copyButton.textContent = '已複製 OK';
    } catch (error) {
      copyButton.textContent = '請手動複製';
    }
    window.setTimeout(() => { copyButton.textContent = '複製乾淨網址'; }, 1800);
  }

  if (cleanButton && cleanLabel && demoAddress && demoAfter && demoStatus && removedChips && copyButton) {
    cleanButton.addEventListener('click', () => {
      isCleaned = !isCleaned;
      renderDemo();
    });
    copyButton.addEventListener('click', () => copyDemoUrl());
  }

  if (nav && menuToggle) {
    menuToggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      menuToggle.setAttribute('aria-expanded', String(open));
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('is-open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  if (navBar) {
    window.addEventListener('scroll', () => {
      navBar.classList.toggle('is-scrolled', window.scrollY > 12);
    }, { passive: true });
  }

  if (year) year.textContent = String(new Date().getFullYear());

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        currentObserver.unobserve(entry.target);
      }
    }, { threshold: .12 });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  if (cleanButton && cleanLabel && demoAddress && demoAfter && demoStatus && removedChips && copyButton) {
    renderDemo();
  }
})();
