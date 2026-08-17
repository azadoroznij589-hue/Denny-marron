document.documentElement.classList.add('js')

const mobileNav = document.querySelector('.mobile-nav')
const menuButton = document.querySelector('.mobile-nav__toggle')
const menuPanel = document.querySelector('.mobile-nav__panel')

function setMenu(open) {
  menuButton.setAttribute('aria-expanded', String(open))
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню')
  menuPanel.hidden = !open
  mobileNav.classList.toggle('is-open', open)
}

menuButton.addEventListener('click', () => {
  setMenu(menuButton.getAttribute('aria-expanded') !== 'true')
})

document.addEventListener('click', (event) => {
  if (!mobileNav.contains(event.target)) setMenu(false)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    setMenu(false)
    menuButton.focus()
  }
})

menuPanel.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false)
})

const siteHeader = document.querySelector('.site-header')
const headerNavigationLinks = [...document.querySelectorAll('.desktop-nav > a, .mobile-nav__panel > a')]
const sectionNavigation = document.querySelector('.section-nav')
const sectionNavigationLinks = [...document.querySelectorAll('.section-nav > a')]
const pageSections = [...document.querySelectorAll('[data-nav-theme]')]

function updateHeaderState() {
  siteHeader.classList.toggle('is-scrolled', window.scrollY > 80)
}

updateHeaderState()
window.addEventListener('scroll', updateHeaderState, { passive:true })

function setActiveSection(section) {
  const allNavigationLinks = [...headerNavigationLinks, ...sectionNavigationLinks]

  allNavigationLinks.forEach((link) => {
    const active = link.getAttribute('href') === `#${section.id}`
    link.classList.toggle('is-active', active)
    if (active) link.setAttribute('aria-current', 'location')
    else link.removeAttribute('aria-current')
  })

  if (sectionNavigation) {
    sectionNavigation.classList.toggle('is-light', section.dataset.navTheme === 'light')
    sectionNavigation.classList.toggle('is-dark', section.dataset.navTheme !== 'light')
  }
}

if ('IntersectionObserver' in window && pageSections.length) {
  const visibleSections = new Map()
  const navigationObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) visibleSections.set(entry.target, entry.intersectionRatio)
      else visibleSections.delete(entry.target)
    })

    const currentSection = [...visibleSections.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (currentSection) setActiveSection(currentSection)
  }, { rootMargin:'-42% 0px -42% 0px', threshold:[0,.01,.1,.25,.5] })

  pageSections.forEach((section) => navigationObserver.observe(section))
} else if (pageSections.length) {
  setActiveSection(pageSections[0])
}

document.querySelectorAll('.section-nav a, .desktop-nav > a, .mobile-nav__panel > a, .scroll-indicator, .brand').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'))
    if (!target) event.preventDefault()
  })
})

const LEAD_ENDPOINT = '/api/lead'
const leadModal = document.querySelector('.lead-modal')
const leadForm = leadModal?.querySelector('.lead-form')
const leadTriggers = [...document.querySelectorAll('[data-lead-source]')]
let leadTrigger = null

async function submitLead(formData) {
  const lead = {
    name: formData.get('name'),
    contact: formData.get('contact'),
    comment: formData.get('comment'),
    source: formData.get('source'),
    personalDataConsent: formData.get('personalDataConsent') === 'true',
    website: formData.get('website') || ''
  }

  const response = await fetch(LEAD_ENDPOINT, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(lead)
  })

  const result = await response.json().catch(() => ({ ok:false }))
  if (!response.ok || !result.ok) throw new Error(`Lead request failed: ${response.status}`)
  return result
}

if (leadModal && leadForm) {
  let isSubmitting = false
  const closeButton = leadModal.querySelector('.lead-modal__close')
  const submitButton = leadForm.querySelector('.lead-form__submit')
  const submitLabel = submitButton.querySelector('span')
  const status = leadForm.querySelector('.lead-form__status')
  const statusTitle = status.querySelector('strong')
  const statusText = status.querySelector('p')
  const nameField = leadForm.elements.namedItem('name')
  const contactField = leadForm.elements.namedItem('contact')
  const consentField = leadForm.elements.namedItem('personalDataConsent')
  const sourceField = leadForm.elements.namedItem('source')

  function clearFieldError(field) {
    const wrapper = field.closest('.lead-field')
    wrapper.classList.remove('is-invalid')
    wrapper.querySelector('.lead-field__error').textContent = ''
    field.removeAttribute('aria-invalid')
  }

  function validateLeadForm() {
    let firstInvalid = null

    ;[nameField, contactField].forEach((field) => {
      clearFieldError(field)
      if (field.value.trim()) return

      const wrapper = field.closest('.lead-field')
      wrapper.classList.add('is-invalid')
      wrapper.querySelector('.lead-field__error').textContent = field === nameField ? 'Укажите ваше имя.' : 'Укажите телефон или Telegram.'
      field.setAttribute('aria-invalid', 'true')
      firstInvalid ||= field
    })

    const consent = consentField.closest('.lead-consent')
    consent.classList.toggle('is-invalid', !consentField.checked)
    consent.querySelector('.lead-consent__error').textContent = consentField.checked ? '' : 'Необходимо дать согласие на обработку персональных данных.'
    consentField.toggleAttribute('aria-invalid', !consentField.checked)
    if (!consentField.checked) firstInvalid ||= consentField

    firstInvalid?.focus()
    return !firstInvalid
  }

  function setLeadStatus(title, message, visible = true) {
    statusTitle.textContent = title
    statusText.textContent = message
    status.hidden = !visible
  }

  function openLeadModal(trigger) {
    leadTrigger = trigger
    leadForm.reset()
    leadForm.classList.remove('is-complete')
    ;[nameField, contactField].forEach(clearFieldError)
    consentField.closest('.lead-consent').classList.remove('is-invalid')
    consentField.closest('.lead-consent').querySelector('.lead-consent__error').textContent = ''
    consentField.removeAttribute('aria-invalid')
    setLeadStatus('', '', false)
    submitButton.disabled = false
    submitLabel.textContent = 'ОТПРАВИТЬ ЗАЯВКУ'
    sourceField.value = trigger.dataset.leadSource
    leadModal.showModal()
    document.body.classList.add('has-lead-modal')
    requestAnimationFrame(() => nameField.focus())
  }

  function closeLeadModal() {
    if (leadModal.open) leadModal.close()
  }

  leadTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault()
      openLeadModal(trigger)
    })
  })

  ;[nameField, contactField].forEach((field) => field.addEventListener('input', () => clearFieldError(field)))
  consentField.addEventListener('change', () => {
    const consent = consentField.closest('.lead-consent')
    consent.classList.remove('is-invalid')
    consent.querySelector('.lead-consent__error').textContent = ''
    consentField.removeAttribute('aria-invalid')
  })
  closeButton.addEventListener('click', closeLeadModal)
  leadModal.addEventListener('click', (event) => {
    if (event.target === leadModal) closeLeadModal()
  })
  leadModal.addEventListener('close', () => {
    document.body.classList.remove('has-lead-modal')
    leadTrigger?.focus()
  })

  leadForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (isSubmitting) return
    if (!validateLeadForm()) return

    isSubmitting = true
    submitButton.disabled = true
    submitLabel.textContent = 'ОТПРАВЛЯЕМ...'
    setLeadStatus('ОТПРАВЛЯЕМ...', 'Пожалуйста, подождите.')

    try {
      await submitLead(new FormData(leadForm))
      leadForm.reset()
      leadForm.classList.add('is-complete')
      setLeadStatus('ЗАЯВКА ОТПРАВЛЕНА', 'Спасибо. Я свяжусь с вами в ближайшее время.')
    } catch (error) {
      console.error(error)
      submitButton.disabled = false
      submitLabel.textContent = 'ОТПРАВИТЬ ЗАЯВКУ'
      setLeadStatus('НЕ УДАЛОСЬ ОТПРАВИТЬ', 'Попробуйте ещё раз или напишите мне напрямую.')
    } finally {
      isSubmitting = false
    }
  })
}

const revealSections = document.querySelectorAll('[data-reveal]')

if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      observer.unobserve(entry.target)
    })
  }, { threshold: 0.12 })

  revealSections.forEach((section) => revealObserver.observe(section))
} else {
  revealSections.forEach((section) => section.classList.add('is-visible'))
}

const atmosphereGallery = document.querySelector('.atmosphere__gallery')

if (atmosphereGallery) {
  const atmospherePhotos = [...atmosphereGallery.querySelectorAll('.atmosphere__photo')]
  const atmospherePrevious = atmosphereGallery.querySelector('.atmosphere__slider-nav--prev')
  const atmosphereNext = atmosphereGallery.querySelector('.atmosphere__slider-nav--next')
  const atmosphereCounter = atmosphereGallery.querySelector('.atmosphere__slider-counter')
  const atmosphereControls = [atmospherePrevious, atmosphereNext, atmosphereCounter]
  const mobileSlider = window.matchMedia('(max-width: 620px)')
  let activeAtmospherePhoto = 0
  let atmosphereTouchX = 0
  let atmosphereTouchY = 0

  function renderAtmosphereSlider() {
    atmosphereControls.forEach((control) => { control.hidden = !mobileSlider.matches })
    atmospherePhotos.forEach((photo, index) => {
      photo.classList.toggle('is-active', index === activeAtmospherePhoto)
      if (mobileSlider.matches) photo.setAttribute('aria-hidden', String(index !== activeAtmospherePhoto))
      else photo.removeAttribute('aria-hidden')
    })
    atmosphereCounter.textContent = `${String(activeAtmospherePhoto + 1).padStart(2, '0')} / ${String(atmospherePhotos.length).padStart(2, '0')}`
  }

  function changeAtmospherePhoto(direction) {
    activeAtmospherePhoto = (activeAtmospherePhoto + direction + atmospherePhotos.length) % atmospherePhotos.length
    renderAtmosphereSlider()
  }

  atmospherePrevious.addEventListener('click', () => changeAtmospherePhoto(-1))
  atmosphereNext.addEventListener('click', () => changeAtmospherePhoto(1))
  atmosphereGallery.addEventListener('touchstart', (event) => {
    atmosphereTouchX = event.changedTouches[0].clientX
    atmosphereTouchY = event.changedTouches[0].clientY
  }, { passive:true })
  atmosphereGallery.addEventListener('touchend', (event) => {
    if (!mobileSlider.matches) return
    const distanceX = event.changedTouches[0].clientX - atmosphereTouchX
    const distanceY = event.changedTouches[0].clientY - atmosphereTouchY
    if (Math.abs(distanceX) > 50 && Math.abs(distanceX) > Math.abs(distanceY) * 1.2) {
      changeAtmospherePhoto(distanceX > 0 ? -1 : 1)
    }
  }, { passive:true })
  mobileSlider.addEventListener('change', renderAtmosphereSlider)
  renderAtmosphereSlider()
}

const eventPhotos = [...document.querySelectorAll('.events__photo')]
const lightbox = document.querySelector('.lightbox')

if (lightbox && eventPhotos.length) {
  const lightboxImage = lightbox.querySelector('.lightbox__image')
  const lightboxPlaceholder = lightbox.querySelector('.lightbox__placeholder')
  const lightboxCounter = lightbox.querySelector('.lightbox__counter')
  let activePhoto = 0
  let touchStartX = 0

  eventPhotos.forEach((photo, index) => {
    const source = photo.dataset.src.trim()
    if (source && !photo.querySelector('img')) {
      const image = document.createElement('img')
      image.src = source
      image.alt = photo.getAttribute('aria-label').replace('Открыть ', '')
      image.loading = 'lazy'
      photo.append(image)
    }

    const placeholder = photo.querySelector('.events__placeholder')
    if (placeholder && source) placeholder.hidden = true

    photo.addEventListener('click', () => openLightbox(index))
  })

  function renderLightbox() {
    const photo = eventPhotos[activePhoto]
    const source = photo.dataset.src.trim()
    lightboxCounter.textContent = `${String(activePhoto + 1).padStart(2, '0')} / ${String(eventPhotos.length).padStart(2, '0')}`
    lightboxImage.hidden = !source
    lightboxPlaceholder.hidden = Boolean(source)

    if (source) {
      lightboxImage.src = source
      lightboxImage.alt = photo.getAttribute('aria-label').replace('Открыть ', '')
    } else {
      lightboxImage.removeAttribute('src')
      lightboxPlaceholder.textContent = activePhoto === 0 ? '01 / ГЛАВНОЕ ФОТО' : String(activePhoto + 1).padStart(2, '0')
    }
  }

  function openLightbox(index) {
    activePhoto = index
    renderLightbox()
    lightbox.showModal()
    document.body.classList.add('has-lightbox')
  }

  function closeLightbox() {
    lightbox.close()
    document.body.classList.remove('has-lightbox')
    eventPhotos[activePhoto].focus()
  }

  function changePhoto(direction) {
    activePhoto = (activePhoto + direction + eventPhotos.length) % eventPhotos.length
    renderLightbox()
  }

  lightbox.querySelector('.lightbox__close').addEventListener('click', closeLightbox)
  lightbox.querySelector('.lightbox__nav--prev').addEventListener('click', () => changePhoto(-1))
  lightbox.querySelector('.lightbox__nav--next').addEventListener('click', () => changePhoto(1))
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox()
  })
  lightbox.querySelector('.lightbox__content').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeLightbox()
  })
  lightbox.addEventListener('close', () => document.body.classList.remove('has-lightbox'))
  lightbox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') changePhoto(-1)
    if (event.key === 'ArrowRight') changePhoto(1)
  })
  lightbox.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX
  }, { passive:true })
  lightbox.addEventListener('touchend', (event) => {
    const distance = event.changedTouches[0].clientX - touchStartX
    if (Math.abs(distance) > 50) changePhoto(distance > 0 ? -1 : 1)
  }, { passive:true })
}
