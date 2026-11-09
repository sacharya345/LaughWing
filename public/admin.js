const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const adminToast = document.querySelector("#admin-toast");
const productForm = document.querySelector("#product-form");
let csrfToken = "";
let editingProductId = null;
let productImagePreviewUrl = "";
let removeProductImage = false;
let lastVisitCursor = null;
let toastTimer;
let notificationPollTimer;
let knownNotificationIds = null;

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
  adminToast.textContent = message;
  adminToast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => adminToast.classList.add("hidden"), 3500);
}

async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (csrfToken && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/admin/login") showLogin();
    throw new Error(result.error || "That request couldn't be completed. Please try again.");
  }
  return result;
}

function showLogin() {
  clearInterval(notificationPollTimer);
  notificationPollTimer = null;
  knownNotificationIds = null;
  csrfToken = "";
  loginView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  if (!notificationPollTimer) {
    notificationPollTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshNotifications(true).catch((error) => showToast(error.message));
      }
    }, 30000);
  }
}

function renderNotificationCount(count) {
  const badge = document.querySelector("#notification-count");
  const unreadCount = Number(count) || 0;
  badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  badge.classList.toggle("hidden", unreadCount === 0);
  badge.setAttribute("aria-label", `${unreadCount} unread notifications`);
}

function renderNotifications(notifications) {
  const list = document.querySelector("#notifications-list");
  list.innerHTML = notifications.length
    ? notifications.map((notification) => `
      <article class="rounded-3 border p-3 ${notification.is_read ? "bg-white" : "bg-wing-yellow/10"}">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="mb-1 font-bold">${notification.is_read ? "" : '<span class="me-1 inline-block h-2 w-2 rounded-full bg-wing-blue" aria-label="Unread"></span>'}Order #${escapeHtml(notification.order_id)} placed</p>
            <p class="mb-1 text-sm text-wing-ink/70">${escapeHtml(notification.customer_name)} · ${escapeHtml(notification.fulfillment)} · ${money(notification.total)}</p>
            <time class="text-xs text-wing-ink/60" datetime="${escapeHtml(notification.created_at)}">${escapeHtml(new Date(notification.created_at).toLocaleString())}</time>
          </div>
          <div class="flex shrink-0 gap-2">
            <button class="btn btn-outline-wing btn-sm rounded-pill" type="button" data-open-order>View orders</button>
            ${notification.is_read ? "" : `<button class="btn btn-outline-wing btn-sm rounded-pill" type="button" data-mark-notification="${escapeHtml(notification.id)}">Mark read</button>`}
          </div>
        </div>
      </article>
    `).join("")
    : '<p class="mb-0 py-4 text-center text-wing-ink/60">No order notifications yet.</p>';
}

async function refreshNotifications(announceNew = false) {
  const result = await api("/api/admin/notifications");
  renderNotificationCount(result.unreadCount);
  renderNotifications(result.notifications);

  const currentIds = new Set(result.notifications.map((notification) => String(notification.id)));
  if (announceNew && knownNotificationIds) {
    const newCount = [...currentIds].filter((id) => !knownNotificationIds.has(id)).length;
    if (newCount) showToast(`${newCount} new customer order${newCount === 1 ? "" : "s"} received.`);
  }
  knownNotificationIds = currentIds;
}

function renderOrders(orders) {
  const today = new Date();
  const todayOrders = orders.filter((order) => {
    const created = new Date(order.created_at);
    return created.getFullYear() === today.getFullYear() &&
      created.getMonth() === today.getMonth() &&
      created.getDate() === today.getDate();
  });
  document.querySelector("#orders-today").textContent = String(todayOrders.length);
  document.querySelector("#orders-open").textContent = String(
    orders.filter((order) => !["completed", "cancelled"].includes(order.status)).length,
  );
  const table = document.querySelector("#orders-table");

  if (!orders.length) {
    table.innerHTML = '<tr><td class="p-4 text-wing-ink/60" colspan="7">No orders yet. Your next happy customer is just around the corner.</td></tr>';
    return;
  }

  table.innerHTML = orders.map((order) => {
    const contact = [order.customer_phone, order.customer_email].filter(Boolean).join("<br>");
    const itemList = order.items.map((item) =>
      `${item.quantity} × ${escapeHtml(item.name)}${item.spiceLevel ? ` (${escapeHtml(item.spiceLevel)})` : ""}`).join("<br>");
    const created = new Date(order.created_at).toLocaleString();
    const notification = escapeHtml(order.notification_status);
    const retry = order.notification_status !== "sent" && order.notification_status !== "disabled"
      ? `<button class="btn btn-link btn-sm p-0 text-wing-blue" type="button" data-retry="${order.id}">Retry alert</button>`
      : "";

    return `
      <tr>
        <td><span class="font-black">#${order.id}</span><br><span class="text-xs text-wing-ink/60">${escapeHtml(created)}</span></td>
        <td><span class="font-bold">${escapeHtml(order.customer_name)}</span><br><span class="text-xs">${contact}</span></td>
        <td class="text-sm">${itemList}</td>
        <td><span class="status-pill">${escapeHtml(order.fulfillment)}</span>${order.delivery_address
          ? `<p class="mb-0 mt-1 max-w-[12rem] text-xs">${escapeHtml(order.delivery_address)}</p>` : ""}</td>
        <td class="whitespace-nowrap font-extrabold">${money(order.total)}</td>
        <td>
          <label class="sr-only" for="order-status-${order.id}">Status for order ${order.id}</label>
          <select class="form-select form-select-sm min-w-[8rem]" id="order-status-${order.id}" data-status="${order.id}">
            ${["pending", "confirmed", "preparing", "ready", "completed", "cancelled"].map((status) =>
              `<option value="${status}" ${status === order.status ? "selected" : ""}>${status[0].toUpperCase()}${status.slice(1)}</option>`).join("")}
          </select>
        </td>
        <td><span class="status-pill">${notification}</span><div class="mt-1">${retry}</div></td>
      </tr>
      ${order.notes ? `<tr class="table-light"><td colspan="7"><span class="font-bold">Kitchen note:</span> ${escapeHtml(order.notes)}</td></tr>` : ""}
    `;
  }).join("");
}

function renderProducts(products) {
  document.querySelector("#products-available").textContent = String(
    products.filter((product) => product.isAvailable).length,
  );
  const table = document.querySelector("#products-table");
  table.innerHTML = products.length
    ? products.map((product) => `
      <tr>
        <td>
          <div class="flex items-center gap-2">
            ${product.imageUrl
              ? `<img class="h-12 w-12 rounded-lg object-cover" src="${escapeHtml(product.imageUrl)}" alt="">`
              : `<span class="text-2xl" aria-hidden="true">${escapeHtml(product.emoji)}</span>`}
            <div><span class="font-bold">${escapeHtml(product.name)}</span><br><span class="text-xs text-wing-ink/60">${escapeHtml(product.description)}</span></div>
          </div>
        </td>
        <td>${escapeHtml(product.category)}</td>
        <td class="whitespace-nowrap">${product.price === null ? "Set a price" : money(product.price)}</td>
        <td><span class="status-pill">${product.isAvailable ? "Available" : "Unavailable"}</span></td>
        <td>
          <div class="flex gap-2">
            <button class="btn btn-outline-wing btn-sm rounded-pill" type="button" data-edit="${product.id}">Edit</button>
            <button class="btn btn-outline-danger btn-sm rounded-pill" type="button" data-delete="${product.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("")
    : '<tr><td class="p-4 text-wing-ink/60" colspan="5">No menu items yet. Add one to get started.</td></tr>';
}

function renderVisitors(stats, append = false) {
  if (stats.today !== undefined) {
    document.querySelector("#visits-today").textContent = String(stats.today);
    document.querySelector("#visits-all-time").textContent = String(stats.allTime);
  }
  const table = document.querySelector("#visits-table");
  const rows = stats.recent.map((visit) => `
      <tr>
        <td>${escapeHtml(new Date(visit.visited_at).toLocaleString())}</td>
        <td>${escapeHtml(visit.page_path)}</td>
      </tr>
    `).join("");
  if (!append && !rows) {
    table.innerHTML = '<tr><td class="p-4 text-wing-ink/60" colspan="2">No visits recorded yet.</td></tr>';
  } else {
    table.innerHTML = append ? table.innerHTML + rows : rows;
  }
  const lastVisit = stats.recent.at(-1);
  if (lastVisit) lastVisitCursor = { id: lastVisit.id, visitedAt: lastVisit.visited_at };
  document.querySelector("#load-more-visits").hidden = !stats.hasMore;
}

function renderAdmins(admins) {
  const table = document.querySelector("#admins-table");
  table.innerHTML = admins.length
    ? admins.map((admin) => `
      <tr>
        <td class="font-bold">${escapeHtml(admin.email)}</td>
        <td>${escapeHtml(new Date(admin.created_at).toLocaleDateString())}</td>
      </tr>
    `).join("")
    : '<tr><td class="p-4 text-wing-ink/60" colspan="2">No admin accounts found.</td></tr>';
}

function renderAdminReviews(reviews) {
  const list = document.querySelector("#admin-reviews-list");
  list.innerHTML = reviews.length
    ? reviews.map((review) => {
      const date = new Date(review.createdAt);
      const dateLabel = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
      return `
        <article class="admin-review-card rounded-3 border p-3" data-review="${escapeHtml(review.id)}">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-baseline gap-2">
                <strong>${escapeHtml(review.name)}</strong>
                <time class="text-xs text-wing-ink/60" datetime="${escapeHtml(review.createdAt)}">${escapeHtml(dateLabel)}</time>
              </div>
              <p class="mb-1 mt-1 text-amber-600" aria-label="${escapeHtml(review.rating)} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>
              <p class="mb-0 whitespace-pre-wrap break-words">${escapeHtml(review.review)}</p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="btn ${review.adminLiked ? "btn-wing" : "btn-outline-wing"} btn-sm rounded-pill" type="button" data-review-like="${escapeHtml(review.id)}" aria-pressed="${review.adminLiked}">
                ${review.adminLiked ? "👍 Liked" : "👍 Like"}
              </button>
              <button class="btn btn-outline-danger btn-sm rounded-pill" type="button" data-review-delete="${escapeHtml(review.id)}">Delete</button>
            </div>
          </div>
          <form class="admin-review-response-form mt-3 grid gap-2" data-review-response="${escapeHtml(review.id)}">
            <label class="form-label mb-0 text-sm font-bold">Public owner response
              <textarea class="form-control mt-1 rounded-xl" name="response" rows="2" maxlength="1000" placeholder="Write a response shown on the website">${escapeHtml(review.adminResponse || "")}</textarea>
            </label>
            <div><button class="btn btn-outline-wing btn-sm rounded-pill px-3" type="submit">Save response</button></div>
          </form>
        </article>
      `;
    }).join("")
    : '<p class="mb-0 py-4 text-center text-wing-ink/60">No customer reviews yet.</p>';
}

async function refreshAdminReviews() {
  const result = await api("/api/admin/reviews");
  renderAdminReviews(result.reviews);
}

function renderSettings(settings) {
  const form = document.querySelector("#settings-form");
  form.elements.storeOpen.checked = settings.storeOpen;
  form.elements.pickupEnabled.checked = settings.pickupEnabled;
  form.elements.deliveryEnabled.checked = settings.deliveryEnabled;
  form.elements.deliveryFee.value = settings.deliveryFee.toFixed(2);
}

async function refreshDashboard(showMessage = false) {
  const result = await api("/api/admin/dashboard");
  renderOrders(result.orders);
  renderProducts(result.products);
  renderSettings(result.settings);
  renderVisitors(result.visitorStats);
  renderAdmins(result.admins);
  renderNotificationCount(result.unreadNotifications);
  await Promise.all([refreshNotifications(), refreshAdminReviews()]);
  if (showMessage) showToast("Everything's up to date.");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#login-error");
  const button = document.querySelector("#login-submit");
  error.classList.add("hidden");
  button.disabled = true;
  button.textContent = "Signing in…";

  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: loginForm.elements.email.value,
        password: loginForm.elements.password.value,
      }),
    });
    csrfToken = result.csrfToken;
    loginForm.reset();
    showDashboard();
    await refreshDashboard();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

document.querySelector("[role=tablist]").addEventListener("click", (event) => {
  const button = event.target.closest("[data-panel]");
  if (!button) return;
  document.querySelectorAll("[data-panel]").forEach((tab) => {
    const isActive = tab === button;
    tab.classList.toggle("btn-wing", isActive);
    tab.classList.toggle("btn-outline-wing", !isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll(".admin-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `${button.dataset.panel}-panel`);
  });
});

document.querySelector("#notifications-list").addEventListener("click", async (event) => {
  const markReadButton = event.target.closest("[data-mark-notification]");
  const openOrdersButton = event.target.closest("[data-open-order]");
  if (markReadButton) {
    markReadButton.disabled = true;
    try {
      await api(`/api/admin/notifications/${markReadButton.dataset.markNotification}`, { method: "PATCH" });
      await refreshNotifications();
    } catch (error) {
      showToast(error.message);
      markReadButton.disabled = false;
    }
  } else if (openOrdersButton) {
    openOrdersButton.disabled = true;
    try {
      await refreshDashboard();
      document.querySelector('[data-panel="orders"]').click();
    } catch (error) {
      showToast(error.message);
    } finally {
      openOrdersButton.disabled = false;
    }
  }
});

document.querySelector("#mark-all-notifications-read").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api("/api/admin/notifications/read-all", { method: "POST", body: JSON.stringify({}) });
    await refreshNotifications();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-reviews-list").addEventListener("click", async (event) => {
  const likeButton = event.target.closest("[data-review-like]");
  const deleteButton = event.target.closest("[data-review-delete]");
  if (likeButton) {
    likeButton.disabled = true;
    try {
      await api(`/api/admin/reviews/${likeButton.dataset.reviewLike}/like`, { method: "POST" });
      await refreshAdminReviews();
      showToast("Review like updated.");
    } catch (error) {
      showToast(error.message);
      likeButton.disabled = false;
    }
  } else if (deleteButton) {
    const reviewText = deleteButton.closest(".admin-review-card").querySelector("p.whitespace-pre-wrap").textContent;
    if (!window.confirm(`Delete this customer review?\n\n"${reviewText.slice(0, 120)}"`)) return;
    deleteButton.disabled = true;
    try {
      await api(`/api/admin/reviews/${deleteButton.dataset.reviewDelete}`, { method: "DELETE" });
      await refreshAdminReviews();
      showToast("Review deleted.");
    } catch (error) {
      showToast(error.message);
      deleteButton.disabled = false;
    }
  }
});

document.querySelector("#admin-reviews-list").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-review-response]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(`/api/admin/reviews/${form.dataset.reviewResponse}/response`, {
      method: "PUT",
      body: JSON.stringify({ response: form.elements.response.value }),
    });
    await refreshAdminReviews();
    showToast("Owner response published.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

document.querySelector("#refresh-reviews").addEventListener("click", () => {
  refreshAdminReviews().then(() => showToast("Reviews refreshed.")).catch((error) => showToast(error.message));
});

document.querySelector("#logout").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
    showLogin();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#refresh-dashboard").addEventListener("click", () => {
  refreshDashboard(true).catch((error) => showToast(error.message));
});

document.querySelector("#load-more-visits").addEventListener("click", async (event) => {
  if (!lastVisitCursor) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const query = new URLSearchParams({
      before: lastVisitCursor.visitedAt,
      beforeId: String(lastVisitCursor.id),
    });
    const result = await api(`/api/admin/visits?${query}`);
    renderVisitors(result, true);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#orders-table").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-status]");
  if (!select) return;
  try {
    await api(`/api/admin/orders/${select.dataset.status}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value }),
    });
    await refreshDashboard();
    showToast(`Order #${select.dataset.status} updated.`);
  } catch (error) {
    showToast(error.message);
    refreshDashboard().catch((refreshError) => showToast(refreshError.message));
  }
});

document.querySelector("#orders-table").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-retry]");
  if (!button) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/orders/${button.dataset.retry}/retry-notification`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    showToast(`Order alert: ${result.notificationStatus}.`);
    await refreshDashboard();
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
});

function resetProductForm() {
  if (productImagePreviewUrl.startsWith("blob:")) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = "";
  removeProductImage = false;
  editingProductId = null;
  productForm.reset();
  productForm.elements.emoji.value = "🍽️";
  productForm.elements.isAvailable.checked = true;
  document.querySelector("#product-image-preview-wrap").classList.add("hidden");
  document.querySelector("#product-image-preview").classList.add("hidden");
  document.querySelector("#product-image-placeholder").classList.add("hidden");
  document.querySelector("#product-image-remove").textContent = "Remove current photo";
  document.querySelector("#product-form-title").textContent = "Add a menu item";
  document.querySelector("#product-submit").textContent = "Add to menu";
  document.querySelector("#product-cancel").classList.add("hidden");
}

document.querySelector("#products-table").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");
  if (editButton) {
    try {
      const { products } = await api("/api/admin/dashboard");
      const product = products.find((item) => item.id === Number(editButton.dataset.edit));
      if (!product) throw new Error("That menu item was not found.");
      editingProductId = product.id;
      productForm.elements.name.value = product.name;
      productForm.elements.category.value = product.category;
      productForm.elements.price.value = product.price === null ? "" : product.price.toFixed(2);
      productForm.elements.emoji.value = product.emoji;
      productForm.elements.description.value = product.description;
      productForm.elements.isAvailable.checked = product.isAvailable;
      removeProductImage = false;
      productImagePreviewUrl = product.imageUrl || "";
      renderProductImagePreview(product.imageUrl, product.emoji);
      document.querySelector("#product-form-title").textContent = "Edit menu item";
      document.querySelector("#product-submit").textContent = "Save changes";
      document.querySelector("#product-cancel").classList.remove("hidden");
      productForm.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      showToast(error.message);
    }
  } else if (deleteButton) {
    const productName = deleteButton.closest("tr").querySelector("td").textContent.trim();
    if (!window.confirm(`Delete ${productName}? Past orders will keep their saved item details.`)) return;
    try {
      await api(`/api/admin/products/${deleteButton.dataset.delete}`, { method: "DELETE" });
      await refreshDashboard();
      showToast("Menu item deleted.");
      if (editingProductId === Number(deleteButton.dataset.delete)) resetProductForm();
    } catch (error) {
      showToast(error.message);
    }
  }
});

function renderProductImagePreview(source, emoji) {
  const wrapper = document.querySelector("#product-image-preview-wrap");
  const image = document.querySelector("#product-image-preview");
  const placeholder = document.querySelector("#product-image-placeholder");
  const removeButton = document.querySelector("#product-image-remove");
  wrapper.classList.remove("hidden");
  if (source) {
    image.src = source;
    image.classList.remove("hidden");
    placeholder.classList.add("hidden");
    removeButton.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    placeholder.textContent = emoji;
    placeholder.classList.remove("hidden");
    removeButton.classList.toggle("hidden", !editingProductId);
  }
  removeButton.textContent = removeProductImage ? "Photo will be removed" : "Remove current photo";
}

productForm.elements.image.addEventListener("change", () => {
  const file = productForm.elements.image.files[0];
  if (!file) {
    renderProductImagePreview(removeProductImage ? "" : productImagePreviewUrl, productForm.elements.emoji.value);
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    productForm.elements.image.value = "";
    showToast("Choose a JPEG, PNG, or WebP image smaller than 5 MB.");
    return;
  }
  if (productImagePreviewUrl.startsWith("blob:")) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = URL.createObjectURL(file);
  removeProductImage = false;
  renderProductImagePreview(productImagePreviewUrl, productForm.elements.emoji.value);
});

document.querySelector("#product-image-remove").addEventListener("click", () => {
  if (productImagePreviewUrl.startsWith("blob:")) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = "";
  productForm.elements.image.value = "";
  removeProductImage = Boolean(editingProductId);
  renderProductImagePreview("", productForm.elements.emoji.value);
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(productForm);
  const payload = {
    name: values.get("name"),
    category: values.get("category"),
    price: values.get("price"),
    emoji: values.get("emoji"),
    description: values.get("description"),
    isAvailable: values.get("isAvailable") === "on",
  };
  try {
    const existingProductId = editingProductId;
    const savedProduct = await api(existingProductId ? `/api/admin/products/${existingProductId}` : "/api/admin/products", {
      method: editingProductId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    const productId = existingProductId || savedProduct.product.id;
    const image = productForm.elements.image.files[0];
    let message = "Menu updated.";
    try {
      if (image) {
        const formData = new FormData();
        formData.append("image", image);
        await api(`/api/admin/products/${productId}/image`, { method: "POST", body: formData });
      } else if (removeProductImage && existingProductId) {
        await api(`/api/admin/products/${productId}/image`, { method: "DELETE" });
      }
    } catch (imageError) {
      message = `Menu saved, but the photo could not be saved: ${imageError.message}`;
    }
    resetProductForm();
    await refreshDashboard();
    showToast(message);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#product-cancel").addEventListener("click", resetProductForm);

document.querySelector("#admin-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/admins", {
      method: "POST",
      body: JSON.stringify({
        email: form.elements.email.value,
        password: form.elements.password.value,
      }),
    });
    form.reset();
    await refreshDashboard();
    showToast("Admin account created. Share the password securely.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        storeOpen: form.elements.storeOpen.checked,
        pickupEnabled: form.elements.pickupEnabled.checked,
        deliveryEnabled: form.elements.deliveryEnabled.checked,
        deliveryFee: form.elements.deliveryFee.value,
      }),
    });
    renderSettings(result.settings);
    showToast("Store settings saved.");
  } catch (error) {
    showToast(error.message);
  }
});

async function initializeAdmin() {
  try {
    const session = await api("/api/admin/session");
    csrfToken = session.csrfToken;
    showDashboard();
    await refreshDashboard();
  } catch (error) {
    if (!error.message.includes("sign in")) showToast(error.message);
    showLogin();
  }
}

initializeAdmin();
