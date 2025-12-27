/**
 * Bay Area Healing Company
 * Main JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // Scroll animation observer
  initScrollAnimations();

  // Smooth scroll for anchor links
  initSmoothScroll();

  // Mobile navigation
  initMobileNav();

  // Navbar background on scroll
  initNavbarScroll();
});

/**
 * Initialize scroll-triggered animations
 */
function initScrollAnimations() {
  const animatedElements = document.querySelectorAll(
    '.section-header, .program-card, .process-step, .testimonial, .faq-item, .about-grid > *'
  );

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -50px 0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        // Stagger the animation based on element index within its parent
        const parent = entry.target.parentElement;
        const siblings = Array.from(parent.children).filter(
          el => el.classList.contains(entry.target.classList[0])
        );
        const siblingIndex = siblings.indexOf(entry.target);

        setTimeout(() => {
          entry.target.classList.add('visible');
        }, siblingIndex * 100);

        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  animatedElements.forEach(el => observer.observe(el));
}

/**
 * Smooth scroll for anchor links
 */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));

      if (target) {
        const navHeight = document.querySelector('.nav').offsetHeight;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });

        // Close mobile nav if open
        document.body.classList.remove('nav-open');
      }
    });
  });
}

/**
 * Mobile navigation toggle
 */
function initMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  const navCta = document.querySelector('.nav-cta');

  if (toggle) {
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('nav-open');

      // Toggle visibility of nav elements for mobile
      if (navLinks) {
        navLinks.style.display = document.body.classList.contains('nav-open') ? 'flex' : '';
      }
    });
  }
}

/**
 * Add background to navbar on scroll
 */
function initNavbarScroll() {
  const nav = document.querySelector('.nav');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
      nav.classList.add('nav-scrolled');
    } else {
      nav.classList.remove('nav-scrolled');
    }

    // Hide/show nav on scroll direction
    if (currentScroll > lastScroll && currentScroll > 500) {
      nav.classList.add('nav-hidden');
    } else {
      nav.classList.remove('nav-hidden');
    }

    lastScroll = currentScroll;
  });
}

/**
 * Counter animation for stats
 */
function animateCounter(element, target, duration = 2000) {
  const start = 0;
  const increment = target / (duration / 16);
  let current = start;

  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      element.textContent = target;
      clearInterval(timer);
    } else {
      element.textContent = Math.floor(current);
    }
  }, 16);
}

// Add CSS for mobile nav and scroll states
const style = document.createElement('style');
style.textContent = `
  .nav-scrolled {
    background-color: rgba(250, 248, 243, 0.98);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  .nav-hidden {
    transform: translateY(-100%);
  }

  .nav {
    transition: transform 0.3s ease, background-color 0.3s ease, box-shadow 0.3s ease;
  }

  @media (max-width: 768px) {
    .nav-open .nav-links {
      display: flex !important;
      position: absolute;
      top: var(--nav-height);
      left: 0;
      right: 0;
      flex-direction: column;
      background-color: var(--color-bg);
      padding: var(--space-lg);
      border-bottom: 1px solid var(--color-border);
      gap: var(--space-md);
    }

    .nav-open .nav-cta {
      display: block !important;
      position: absolute;
      top: calc(var(--nav-height) + 200px);
      left: var(--space-lg);
      right: var(--space-lg);
      text-align: center;
    }
  }
`;
document.head.appendChild(style);
