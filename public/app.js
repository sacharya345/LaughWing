const menuGrid = document.querySelector("#menu-grid");
const filterContainer = document.querySelector("#menu-filters");
const cartPanel = document.querySelector("#cart-panel");
const cartBackdrop = document.querySelector("#cart-backdrop");
const checkoutModal = document.querySelector("#checkout-modal");
const checkoutForm = document.querySelector("#checkout-form");
const cart = new Map();
let products = [];
let settings = {};
let activeCategory = "All";
let selectedFulfillment = "pickup";
let toastTimer;
let heroProducts = [];
let activeHeroSlide = 0;
let heroAutoplayTimer;
let heroAutoplayPaused = false;
const heroImage = document.querySelector("#hero-food-image");
const heroDots = document.querySelector("#hero-carousel-dots");
const heroPrice = document.querySelector("#hero-item-price");

const money = (amount) => new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
}).format(Number(amount));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

function selectedProducts() {
  return [...cart.entries()]
    .map(([id, quantity]) => ({ product: products.find((item) => item.id === id), quantity }))
    .filter((line) => line.product);
}

function subtotal() {
  return selectedProducts().reduce((sum, { product, quantity }) => sum + product.price * quantity, 0);
}

function renderFilters() {
  const categories = ["All", "Laphing", "Chicken", "Drinks"];
  filterContainer.innerHTML = categories.map((category) => `
    <button class="btn ${activeCategory === category ? "btn-wing" : "btn-outline-wing"} rounded-pill px-3 py-2"
      type="button" data-category="${category}" aria-pressed="${activeCategory === category}">
      ${category}
    </button>
  `).join("");
}

function renderMenu() {
  const visibleProducts = products.filter((product) =>
    (activeCategory === "All" || product.category === activeCategory));

  if (!visibleProducts.length) {
    menuGrid.innerHTML = '<div class="col-12 py-5 text-center text-wing-ink/60">No menu items in this category just yet.</div>';
    return;
  }

  menuGrid.innerHTML = visibleProducts.map((product) => {
    const isOrderable = product.isAvailable && product.price !== null && settings.storeOpen &&
      (settings.pickupEnabled || settings.deliveryEnabled);
    const isChickenSausage = product.name === "Chicken Sausage";
    const isDrink = product.category === "Drinks";
    const imageClasses = [
      "menu-photo",
      isChickenSausage ? "menu-photo-sausage" : "",
      isDrink ? "menu-photo-contain" : "",
    ].filter(Boolean).join(" ");
    const artwork = product.imageUrl
      ? `<img class="${imageClasses}" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">`
      : `<span aria-hidden="true">${escapeHtml(product.emoji)}</span>`;
    const artClasses = [
      "menu-art",
      isChickenSausage ? "menu-art-sausage" : "",
      isDrink ? "menu-art-drink" : "",
    ].filter(Boolean).join(" ");
    const quantity = cart.get(product.id) || 0;
    return `
      <article class="col-12 col-sm-6 col-lg-4">
        <div class="menu-card h-full p-3">
          <div class="${artClasses}">${artwork}</div>
          <div class="menu-heading flex items-start justify-between gap-2 pt-3">
            <div>
              <p class="menu-category-badge mb-1">${escapeHtml(product.category)}</p>
              <h3 class="mb-1 text-lg font-extrabold">${escapeHtml(product.name)}</h3>
            </div>
            <span class="whitespace-nowrap rounded-full bg-wing-yellow/40 px-2 py-1 text-sm font-black">
              ${product.price === null ? "Price soon" : money(product.price)}
            </span>
          </div>
          <p class="menu-description mb-3 min-h-[3rem] text-sm leading-relaxed text-wing-ink/70">${escapeHtml(product.description)}</p>
          <div class="menu-quantity" role="group" aria-label="Quantity for ${escapeHtml(product.name)}">
            <button class="menu-quantity-button" type="button" data-menu-decrease="${product.id}" aria-label="Remove one ${escapeHtml(product.name)}"${quantity === 0 || !isOrderable ? " disabled" : ""}>−</button>
            <span class="menu-quantity-value" data-menu-quantity="${product.id}" aria-live="polite">${quantity}</span>
            <button class="menu-quantity-button menu-quantity-add" type="button" data-menu-increase="${product.id}" aria-label="Add one ${escapeHtml(product.name)}"${!isOrderable ? " disabled" : ""}>+</button>
          </div>
          ${!isOrderable ? `<p class="menu-order-status mb-0 mt-2 text-center text-xs text-wing-ink/60">${product.price === null || !product.isAvailable ? "Coming soon" : "Ordering paused"}</p>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderHeroSlide() {
  if (!heroProducts.length) return;
  const product = heroProducts[activeHeroSlide];
  const hasImage = Boolean(product.imageUrl);
  heroImage.classList.add("is-transitioning");
  heroImage.classList.toggle("menu-photo-contain", product.category === "Drinks");
  heroImage.classList.toggle("hero-photo-sausage", product.name === "Chicken Sausage");
  heroImage.hidden = !hasImage;
  heroImage.alt = hasImage ? `${product.name}, featured on the Laugh-Wing menu` : "";
  document.querySelector("#hero-food-placeholder").textContent = hasImage ? "" : product.emoji;
  heroImage.onload = () => heroImage.classList.remove("is-transitioning");
  if (hasImage) heroImage.src = product.imageUrl;
  document.querySelector("#hero-item-category").textContent = product.category;
  document.querySelector("#hero-item-name").textContent = product.name;
  heroPrice.textContent = product.price === null ? "Price coming soon" : money(product.price);
  document.querySelector("#hero-carousel-count").textContent =
    `${String(activeHeroSlide + 1).padStart(2, "0")} / ${String(heroProducts.length).padStart(2, "0")}`;
  heroDots.querySelectorAll("button").forEach((button, index) => {
    const isActive = index === activeHeroSlide;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderHeroCarousel() {
  heroProducts = products;
  if (!heroProducts.length) return;
  const featuredIndex = heroProducts.findIndex((product) => product.name === "Chicken Chilly");
  activeHeroSlide = featuredIndex >= 0 ? featuredIndex : 0;
  heroAutoplayPaused = false;
  heroDots.innerHTML = heroProducts.map((product, index) => `
    <button class="hero-carousel-dot" type="button" data-hero-slide="${index}"
      aria-label="Show ${escapeHtml(product.name)}" aria-pressed="false"></button>
  `).join("");
  renderHeroSlide();
  clearInterval(heroAutoplayTimer);
  heroAutoplayTimer = setInterval(() => {
    if (heroAutoplayPaused || document.hidden) return;
    activeHeroSlide = (activeHeroSlide + 1) % heroProducts.length;
    renderHeroSlide();
  }, 4000);
}

document.querySelector("#hero-previous").addEventListener("click", () => {
  activeHeroSlide = (activeHeroSlide - 1 + heroProducts.length) % heroProducts.length;
  renderHeroSlide();
});

document.querySelector("#hero-next").addEventListener("click", () => {
  activeHeroSlide = (activeHeroSlide + 1) % heroProducts.length;
  renderHeroSlide();
});

document.querySelector("#hero-autoplay-toggle").addEventListener("click", (event) => {
  heroAutoplayPaused = !heroAutoplayPaused;
  const button = event.currentTarget;
  button.textContent = heroAutoplayPaused ? "▶" : "Ⅱ";
  button.setAttribute("aria-label", heroAutoplayPaused ? "Play slideshow" : "Pause slideshow");
  button.setAttribute("aria-pressed", String(heroAutoplayPaused));
});

heroDots.addEventListener("click", (event) => {
  const button = event.target.closest("[data-hero-slide]");
  if (!button) return;
  activeHeroSlide = Number(button.dataset.heroSlide);
  renderHeroSlide();
});

function renderFulfillmentOptions() {
  const methods = [
    { key: "pickup", label: "🏃 Pickup", enabled: settings.pickupEnabled },
    {
      key: "delivery",
      label: "🛵 Delivery (fee included)",
      enabled: settings.deliveryEnabled,
    },
  ].filter((method) => method.enabled);
  if (!methods.some((method) => method.key === selectedFulfillment)) {
    selectedFulfillment = methods[0]?.key || "";
  }

  document.querySelector("#fulfillment-options").innerHTML = methods.map((method) => `
    <button class="btn ${method.key === selectedFulfillment ? "btn-wing" : "btn-outline-wing"} rounded-pill px-3 py-2"
      type="button" data-fulfillment="${method.key}" aria-pressed="${method.key === selectedFulfillment}">
      ${method.label}
    </button>
  `).join("");
  const addressField = document.querySelector("#address-field");
  const addressInput = checkoutForm.elements.address;
  const needsAddress = selectedFulfillment === "delivery";
  addressField.classList.toggle("hidden", !needsAddress);
  addressInput.required = needsAddress;
  document.querySelector("#fulfillment-price-note").textContent = needsAddress
    ? "Delivery fee is included in your total below."
    : "Pickup is free.";
  updateCheckoutTotals();
}

function updateCheckoutTotals() {
  const foodTotal = subtotal();
  const deliveryFee = selectedFulfillment === "delivery" ? settings.deliveryFee : 0;
  document.querySelector("#checkout-subtotal").textContent = money(foodTotal);
  document.querySelector("#checkout-delivery").textContent = selectedFulfillment === "delivery" && deliveryFee
    ? money(deliveryFee)
    : "-";
  document.querySelector("#checkout-total").textContent = money(foodTotal + deliveryFee);
}

function renderCart() {
  const lines = selectedProducts();
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  document.querySelector("#cart-count").textContent = String(quantity);
  document.querySelector("#cart-total").textContent = money(subtotal());
  const canFulfill = settings.pickupEnabled || settings.deliveryEnabled;
  const checkoutButton = document.querySelector("#checkout-open");
  checkoutButton.disabled = lines.length === 0 || !settings.storeOpen || !canFulfill;
  checkoutButton.textContent = !settings.storeOpen || !canFulfill
    ? "Online ordering is paused"
    : "Continue to checkout";

  document.querySelector("#cart-items").innerHTML = lines.length
    ? lines.map(({ product, quantity: count }) => `
      <div class="cart-row flex items-center gap-3 py-3" data-cart-row="${product.id}">
        <div class="cart-item-art ${product.category === "Drinks" ? "menu-art-drink" : ""} ${product.name === "Chicken Sausage" ? "menu-art-sausage" : ""}">
          ${product.imageUrl
    ? `<img class="cart-item-photo ${product.category === "Drinks" ? "menu-photo-contain" : ""} ${product.name === "Chicken Sausage" ? "menu-photo-sausage" : ""}" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">`
    : `<span aria-hidden="true">${escapeHtml(product.emoji)}</span>`}
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="mb-1 truncate text-sm font-extrabold">${escapeHtml(product.name)}</h3>
          <p class="mb-0 text-sm text-wing-ink/70">${money(product.price)} each</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-outline-wing rounded-circle p-0" style="width:2rem;height:2rem" type="button" data-decrease="${product.id}" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
          <span class="min-w-4 text-center text-sm font-bold">${count}</span>
          <button class="btn btn-outline-wing rounded-circle p-0" style="width:2rem;height:2rem" type="button" data-increase="${product.id}" aria-label="Add one ${escapeHtml(product.name)}">+</button>
        </div>
      </div>
    `).join("")
    : '<p class="py-8 text-center text-wing-ink/60">Your order is looking a little lonely. Add a favorite from the menu!</p>';
  updateCheckoutTotals();
}

function setCartOpen(isOpen) {
  cartPanel.classList.toggle("translate-x-full", !isOpen);
  cartPanel.setAttribute("aria-hidden", String(!isOpen));
  cartBackdrop.classList.toggle("hidden", !isOpen);
  document.body.classList.toggle("overflow-hidden", isOpen);
  if (isOpen) document.querySelector("#cart-close").focus();
}

function setCheckoutOpen(isOpen) {
  checkoutModal.classList.toggle("hidden", !isOpen);
  checkoutModal.classList.toggle("flex", isOpen);
  checkoutModal.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("overflow-hidden", isOpen);
  if (isOpen) document.querySelector("#checkout-form [name=name]").focus();
}

async function loadMenu() {
  const response = await fetch("/api/menu");
  if (!response.ok) throw new Error("We couldn't load the menu. Please refresh to try again.");
  const data = await response.json();
  products = data.products;
  settings = data.settings;
  renderHeroCarousel();
  const closedMessage = document.querySelector("#store-status");
  closedMessage.hidden = settings.storeOpen;
  closedMessage.textContent = "The kitchen is taking a little break from online orders. Please check back soon!";
  renderFilters();
  renderMenu();
  renderFulfillmentOptions();
  renderCart();
}

function renderReviews(data) {
  document.querySelector("#review-average").textContent = data.count ? Number(data.average).toFixed(1) : "—";
  document.querySelector("#review-count").textContent =
    `${data.count} ${data.count === 1 ? "review" : "reviews"}`;
  document.querySelector("#review-summary-stars").textContent =
    `${"★".repeat(Math.round(data.average))}${"☆".repeat(5 - Math.round(data.average))}`;

  const reviewList = document.querySelector("#review-list");
  if (!data.reviews.length) {
    reviewList.innerHTML = '<p class="review-list-status" id="review-list-status" role="status">No reviews yet. Be the first to share your experience!</p>';
    return;
  }

  reviewList.innerHTML = data.reviews.map((review) => {
    const date = new Date(review.createdAt);
    const dateLabel = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const stars = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
    return `
      <article class="review-card">
        <div class="review-card-heading">
          <strong>${escapeHtml(review.name)}</strong>
          <time datetime="${escapeHtml(review.createdAt)}">${escapeHtml(dateLabel)}</time>
        </div>
        <div class="review-card-stars" aria-label="${escapeHtml(review.rating)} out of 5 stars">${stars}</div>
        <p class="mb-0">${escapeHtml(review.review)}</p>
      </article>
    `;
  }).join("");
}

async function loadReviews() {
  const response = await fetch("/api/reviews");
  if (!response.ok) throw new Error("Reviews couldn't be loaded. Please refresh to try again.");
  renderReviews(await response.json());
}

const reviewForm = document.querySelector("#review-form");
reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(reviewForm);
  const status = document.querySelector("#review-form-status");
  const submitButton = document.querySelector("#review-submit");
  status.classList.add("hidden");
  submitButton.disabled = true;
  submitButton.textContent = "Sharing your review…";

  try {
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        rating: Number(formData.get("rating")),
        review: formData.get("review"),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Your review couldn't be submitted. Please try again.");

    reviewForm.reset();
    status.textContent = "Thanks! Your review is now published.";
    status.classList.remove("hidden");
    try {
      await loadReviews();
    } catch {
      document.querySelector("#review-list").innerHTML =
        '<p class="review-list-status" role="status">Your review is published. Refresh the page to see the latest reviews.</p>';
    }
  } catch (error) {
    status.textContent = error.message;
    status.classList.remove("hidden");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Share your review";
  }
});

filterContainer.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderFilters();
  renderMenu();
});

menuGrid.addEventListener("click", (event) => {
  const increase = event.target.closest("[data-menu-increase]");
  const decrease = event.target.closest("[data-menu-decrease]");
  const button = increase || decrease;
  if (!button) return;
  const id = Number(increase ? increase.dataset.menuIncrease : decrease.dataset.menuDecrease);
  const next = (cart.get(id) || 0) + (increase ? 1 : -1);
  if (next <= 0) cart.delete(id);
  else cart.set(id, next);
  const quantity = cart.get(id) || 0;
  const card = button.closest(".menu-card");
  card.querySelector(`[data-menu-quantity="${id}"]`).textContent = String(quantity);
  card.querySelector(`[data-menu-decrease="${id}"]`).disabled = quantity === 0;
  renderCart();
});

document.querySelector("#cart-items").addEventListener("click", (event) => {
  const increase = event.target.closest("[data-increase]");
  const decrease = event.target.closest("[data-decrease]");
  if (increase) {
    const id = Number(increase.dataset.increase);
    cart.set(id, (cart.get(id) || 0) + 1);
  } else if (decrease) {
    const id = Number(decrease.dataset.decrease);
    const next = (cart.get(id) || 0) - 1;
    if (next <= 0) cart.delete(id);
    else cart.set(id, next);
  } else {
    return;
  }
  renderCart();
});

document.querySelector("#cart-open").addEventListener("click", () => setCartOpen(true));
document.querySelector("#cart-close").addEventListener("click", () => setCartOpen(false));
cartBackdrop.addEventListener("click", () => setCartOpen(false));
document.querySelector("#mobile-order").addEventListener("click", () => {
  document.querySelector("#menu").scrollIntoView({ behavior: "smooth" });
});

document.querySelector("#checkout-open").addEventListener("click", () => {
  setCartOpen(false);
  checkoutForm.classList.remove("hidden");
  document.querySelector("#checkout-success").classList.add("hidden");
  document.querySelector("#checkout-error").classList.add("hidden");
  checkoutForm.reset();
  renderFulfillmentOptions();
  setCheckoutOpen(true);
});
document.querySelector("#checkout-close").addEventListener("click", () => setCheckoutOpen(false));
checkoutModal.addEventListener("click", (event) => {
  if (event.target === checkoutModal) setCheckoutOpen(false);
});
document.querySelector("#fulfillment-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-fulfillment]");
  if (!button) return;
  selectedFulfillment = button.dataset.fulfillment;
  renderFulfillmentOptions();
});

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(checkoutForm);
  const errorBox = document.querySelector("#checkout-error");
  const successBox = document.querySelector("#checkout-success");
  const submitButton = document.querySelector("#place-order");
  errorBox.classList.add("hidden");
  successBox.classList.add("hidden");

  const phone = String(formData.get("phone") || "").trim();
  const email = String(formData.get("email") || "").trim();
  if (!phone && !email) {
    errorBox.textContent = "Add a phone number or email so the kitchen can confirm your order.";
    errorBox.classList.remove("hidden");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Sending your order…";
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        phone,
        email,
        fulfillment: selectedFulfillment,
        address: formData.get("address"),
        notes: formData.get("notes"),
        items: [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity })),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We couldn't place that order. Please try again.");

    successBox.innerHTML = `<p class="mb-1 text-lg font-black">Order #${escapeHtml(result.orderId)} is in! 🎉</p><p class="mb-0">We'll get in touch to confirm the details. Thanks for choosing Laugh-Wing!</p>`;
    successBox.classList.remove("hidden");
    checkoutForm.reset();
    cart.clear();
    renderCart();
    checkoutForm.classList.add("hidden");
    showToast("Your order is on its way to the kitchen!");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Place my order <span aria-hidden="true">→</span>';
  }
});

loadMenu().catch((error) => {
  menuGrid.innerHTML = `<div class="col-12 py-5 text-center text-wing-ink/60" role="alert">${escapeHtml(error.message)}</div>`;
  showToast(error.message);
});

loadReviews().catch((error) => {
  document.querySelector("#review-list").innerHTML =
    `<p class="review-list-status" role="alert">${escapeHtml(error.message)}</p>`;
  document.querySelector("#review-count").textContent = "Unable to load reviews";
});

fetch("/api/visits", { method: "POST" }).catch((error) => {
  console.warn("Anonymous page visit could not be recorded:", error.message);
});
