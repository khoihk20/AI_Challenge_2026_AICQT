// Frontend cho hệ thống video retrieval.
// Luôn gọi API thật: GET http://localhost:8000/search?query=...&top_k=...
// (Backend: xem app.py — FastAPI + CLIP + FAISS)

const API_BASE = "http://localhost:8000";

const els = {
  form: document.getElementById("searchForm"),
  query: document.getElementById("queryInput"),
  searchBtn: document.getElementById("searchBtn"),
  topkRange: document.getElementById("topkRange"),
  topkNumber: document.getElementById("topkNumber"),
  objectFilters: document.getElementById("objectFilters"),
  clearFilters: document.getElementById("clearFilters"),
  objectNote: document.getElementById("objectNote"),
  debugToggle: document.getElementById("debugToggle"),
  debugOff: document.getElementById("debugOff"),
  debugState: document.getElementById("debugState"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  modal: document.getElementById("modal"),
  modalImg: document.getElementById("modalImg"),
  modalInfo: document.getElementById("modalInfo"),
  modalClose: document.getElementById("modalClose"),
};

// Thông báo lỗi thân thiện với người không rành kỹ thuật.
const MSG = {
  noBackend:
    "Không kết nối được backend. Hãy chạy uvicorn app:app --reload --port 8000 trước.",
  noData:
    "Chưa có dữ liệu ảnh. Hãy thêm keyframe vào data/keyframe/ và file .npy vào data/clip-features-32/, sau đó restart lại backend.",
  noResults: "Không tìm thấy kết quả nào khớp với câu tìm kiếm.",
};

// Kết quả thô của lần search gần nhất (chưa lọc object).
let lastResults = [];
// Đã search lần nào chưa — để phân biệt "chưa search" với "search xong, 0 kết quả".
let hasSearched = false;

/* ---------------- top_k: slider <-> number đồng bộ ---------------- */

function clampTopK(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return 20;
  return Math.min(100, Math.max(1, n));
}

els.topkRange.addEventListener("input", () => {
  els.topkNumber.value = els.topkRange.value;
});

// Dùng "change" (không phải "input") để người dùng gõ được số 2 chữ số
// mà chưa bị clamp giữa chừng.
els.topkNumber.addEventListener("change", () => {
  const n = clampTopK(els.topkNumber.value);
  els.topkNumber.value = n;
  els.topkRange.value = n;
});

/* ---------------- Object filter checkboxes (dynamic) ---------------- */

/**
 * Gom tất cả object thực sự xuất hiện trong kết quả, bỏ trùng lặp.
 * Trả về mảng đã sắp xếp A-Z cho dễ nhìn.
 */
function collectObjects(results) {
  const set = new Set();
  for (const r of results) {
    for (const obj of r.objects || []) {
      // Bỏ qua giá trị rác (null, số, chuỗi rỗng) nếu backend lỡ trả về.
      if (typeof obj === "string" && obj.trim() !== "") {
        set.add(obj.trim());
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Dựng lại checkbox theo đúng danh sách object vừa gom được.
 * Giữ lại các ô đã tick nếu object đó vẫn còn trong kết quả mới,
 * để người dùng không bị mất lựa chọn giữa chừng.
 */
function buildObjectFilters(objects) {
  const stillChecked = new Set(
    selectedObjects().filter((o) => objects.includes(o))
  );

  els.objectFilters.innerHTML = "";
  for (const obj of objects) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = obj;
    cb.checked = stillChecked.has(obj);
    cb.addEventListener("change", render); // lọc client-side, không search lại
    label.appendChild(cb);
    label.appendChild(document.createTextNode(obj));
    els.objectFilters.appendChild(label);
  }

  // Không gom được object nào -> backend chưa hỗ trợ field này.
  const apiHasObjects = objects.length > 0;
  els.objectNote.hidden = apiHasObjects;
  els.clearFilters.hidden = !apiHasObjects;
}

function selectedObjects() {
  return Array.from(
    els.objectFilters.querySelectorAll("input[type=checkbox]:checked")
  ).map((cb) => cb.value);
}

els.clearFilters.addEventListener("click", () => {
  els.objectFilters
    .querySelectorAll("input[type=checkbox]")
    .forEach((cb) => (cb.checked = false));
  render();
});

/* ---------------- DEBUG: giả lập field "objects" ----------------
   Chỉ để thử bộ lọc dynamic TRƯỚC khi backend thật trả về field objects.
   Không ảnh hưởng gì tới luồng gọi API — chỉ gán thêm objects vào kết quả
   đã có sẵn trên màn hình. Xoá nguyên khối này khi backend đã hỗ trợ.        */

const DEBUG_OBJECT_SAMPLE = [
  "Person",
  "Car",
  "Bicycle",
  "Traffic Light",
  "Backpack",
  "Chair",
  "Bottle",
  "Laptop",
  "Dog",
];

let debugMode = false;

/** Chọn ngẫu nhiên 1-3 object khác nhau từ danh sách mẫu. */
function randomObjects() {
  const pool = [...DEBUG_OBJECT_SAMPLE];
  // Fisher-Yates: xáo trộn rồi lấy n phần tử đầu -> đảm bảo không trùng nhau.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const n = 1 + Math.floor(Math.random() * 3); // 1, 2 hoặc 3
  return pool.slice(0, n).sort((a, b) => a.localeCompare(b));
}

/**
 * Gán objects ngẫu nhiên cho toàn bộ kết quả đang hiển thị.
 * Giữ lại objects gốc trong _realObjects để lúc tắt còn khôi phục đúng.
 */
function applyDebugObjects() {
  for (const r of lastResults) {
    if (r._realObjects === undefined) {
      r._realObjects = r.objects || [];
    }
    r.objects = randomObjects();
  }
}

/** Trả kết quả về đúng objects mà backend thật đã trả (thường là []). */
function clearDebugObjects() {
  for (const r of lastResults) {
    if (r._realObjects !== undefined) {
      r.objects = r._realObjects;
      delete r._realObjects;
    }
  }
}

function setDebugMode(on) {
  debugMode = on;
  els.debugOff.hidden = !on;
  els.debugState.hidden = !on;
  els.debugToggle.textContent = on
    ? "Gán lại object ngẫu nhiên"
    : "Test chế độ Object thật";

  if (on) {
    applyDebugObjects();
  } else {
    clearDebugObjects();
  }

  // Đi qua đúng luồng dynamic filter đã làm trước đó.
  buildObjectFilters(collectObjects(lastResults));
  render();
}

els.debugToggle.addEventListener("click", () => {
  if (lastResults.length === 0) {
    setStatus(
      "Hãy search ra kết quả trước, rồi mới bật chế độ test object.",
      "warn"
    );
    return;
  }
  setDebugMode(true);
});

els.debugOff.addEventListener("click", () => setDebugMode(false));

/* ---------------- Search ---------------- */

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  // Cho phép query rỗng: vẫn gửi query="" lên API như bình thường.
  const query = els.query.value.trim();

  const topK = clampTopK(els.topkNumber.value);
  els.topkNumber.value = topK;
  els.topkRange.value = topK;

  setLoading(true);
  setStatus(query ? `Đang tìm "${query}"...` : "Đang tìm...", "loading");

  try {
    const data = await fetchFromApi(query, topK);
    lastResults = data.results || [];
    hasSearched = true;
    // Đang bật chế độ test -> gán objects cho kết quả mới luôn,
    // nếu không thì search xong lại rơi về rỗng, trông như bị hỏng.
    if (debugMode) applyDebugObjects();
    // Mỗi query trả về object khác nhau -> dựng lại checkbox theo kết quả mới.
    buildObjectFilters(collectObjects(lastResults));
    render();
  } catch (err) {
    lastResults = [];
    hasSearched = true;
    buildObjectFilters([]);
    els.grid.innerHTML = "";
    setStatus(err.message, "error");
  } finally {
    setLoading(false);
  }
});

async function fetchFromApi(query, topK) {
  const url = `${API_BASE}/search?query=${encodeURIComponent(
    query
  )}&top_k=${topK}`;

  let res;
  try {
    res = await fetchWithTimeout(url, 60000);
  } catch (err) {
    // fetch chỉ reject khi lỗi mạng / CORS / timeout — tức là không tới được
    // backend. Lỗi HTTP (4xx, 5xx) KHÔNG reject, xử lý ở dưới.
    if (err.name === "AbortError") {
      throw new Error(
        "Backend phản hồi quá lâu (hơn 60 giây). Có thể model đang tải, hãy thử lại sau."
      );
    }
    throw new Error(MSG.noBackend);
  }

  if (!res.ok) {
    throw new Error(
      `Backend báo lỗi (HTTP ${res.status}). Hãy xem log ở cửa sổ chạy uvicorn để biết chi tiết.`
    );
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      "Backend trả về dữ liệu không đọc được. Hãy kiểm tra lại log của uvicorn."
    );
  }

  // app.py trả {"error": "Chưa có dữ liệu data"} khi thư mục data/ còn rỗng.
  if (data.error) {
    throw new Error(
      String(data.error).includes("Chưa có dữ liệu") ? MSG.noData : data.error
    );
  }

  // API thật chưa có field objects -> gán mảng rỗng để filter không crash.
  data.results = (data.results || []).map((r) => ({ objects: [], ...r }));
  return data;
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function setLoading(isLoading) {
  els.searchBtn.disabled = isLoading;
  els.searchBtn.classList.toggle("loading", isLoading);
  els.searchBtn.textContent = isLoading ? "Đang tìm..." : "Search";
}

/* ---------------- Render ---------------- */

function applyFilter(results) {
  const wanted = selectedObjects();
  if (wanted.length === 0) return results;
  // AND logic: chỉ giữ kết quả chứa ĐẦY ĐỦ TẤT CẢ object được tick.
  return results.filter((r) =>
    wanted.every((w) => (r.objects || []).includes(w))
  );
}

function render() {
  if (lastResults.length === 0) {
    els.grid.innerHTML = "";
    // Đã search mà backend trả về 0 ảnh -> báo rõ "không tìm thấy".
    if (hasSearched) {
      setStatus(MSG.noResults, "warn");
    } else {
      setStatus("Chưa có kết quả. Nhập query rồi bấm Search.");
    }
    return;
  }

  const shown = applyFilter(lastResults);
  const wanted = selectedObjects();
  const filterNote =
    wanted.length > 0 ? ` (có đủ: ${wanted.join(" + ")})` : "";
  setStatus(
    `Hiển thị ${shown.length}/${lastResults.length} kết quả${filterNote}.`
  );

  if (shown.length === 0) {
    els.grid.innerHTML =
      '<div class="empty">Không có ảnh nào chứa đủ tất cả object đã chọn.<br><span class="empty-hint">Đang lọc theo kiểu VÀ — chọn càng nhiều object thì kết quả càng ít. Thử bỏ bớt để xem thêm.</span></div>';
    return;
  }

  els.grid.innerHTML = "";
  shown.forEach((item, i) => {
    els.grid.appendChild(buildCard(item, i));
  });
}

function buildCard(item, i) {
  const card = document.createElement("div");
  card.className = "card";

  const thumb = document.createElement("div");
  thumb.className = "card-thumb";

  const img = document.createElement("img");
  img.src = item.image_url;
  img.alt = `result ${item.id}`;
  img.loading = "lazy";
  img.addEventListener("error", () => {
    thumb.classList.add("img-error");
    img.alt = "Không load được ảnh";
  });
  thumb.appendChild(img);

  const body = document.createElement("div");
  body.className = "card-body";

  const top = document.createElement("div");
  top.className = "card-top";
  const rank = document.createElement("span");
  rank.className = "rank";
  rank.textContent = `#${i + 1} · id ${item.id}`;
  const score = document.createElement("span");
  score.className = "score";
  score.textContent = item.score.toFixed(4);
  top.appendChild(rank);
  top.appendChild(score);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = item.video
    ? `${item.video} · frame ${item.frame}`
    : shortUrl(item.image_url);

  body.appendChild(top);
  body.appendChild(meta);

  if (item.objects && item.objects.length > 0) {
    const tags = document.createElement("div");
    tags.className = "tags";
    for (const obj of item.objects) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = obj;
      tags.appendChild(tag);
    }
    body.appendChild(tags);
  }

  card.appendChild(thumb);
  card.appendChild(body);
  card.addEventListener("click", () => openModal(item));
  return card;
}

function shortUrl(url) {
  const parts = String(url).split("/");
  return parts.slice(-2).join("/");
}

/**
 * Hiển thị trạng thái lên giao diện (không dùng console).
 * kind: "" | "error" | "warn" | "loading"
 */
function setStatus(msg, kind = "") {
  els.status.className = "status" + (kind ? ` ${kind}` : "");
  els.status.innerHTML = "";

  if (kind === "loading") {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    els.status.appendChild(spinner);
  }

  const text = document.createElement("span");
  text.textContent = msg;
  els.status.appendChild(text);
}

/* ---------------- Modal / lightbox ---------------- */

function openModal(item) {
  els.modalImg.src = item.image_url;
  els.modalImg.alt = `result ${item.id}`;
  const objs =
    item.objects && item.objects.length
      ? ` · objects: ${item.objects.join(", ")}`
      : "";
  els.modalInfo.textContent = `id ${item.id} · score ${item.score.toFixed(
    4
  )}${objs}\n${item.image_url}`;
  els.modal.hidden = false;
}

function closeModal() {
  els.modal.hidden = true;
  els.modalImg.src = "";
}

els.modalClose.addEventListener("click", closeModal);
els.modal.addEventListener("click", (e) => {
  // Chỉ đóng khi click vào nền, không đóng khi click vào ảnh.
  if (e.target === els.modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.modal.hidden) closeModal();
});

/* ---------------- Init ---------------- */

// Chưa search thì chưa biết có object nào -> để trống, hiện dòng cảnh báo.
buildObjectFilters([]);
