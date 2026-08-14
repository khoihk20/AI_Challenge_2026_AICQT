from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import faiss
import numpy as np
import torch
from transformers import CLIPProcessor, CLIPModel
import glob
import os

app = FastAPI()

# 1. Bật tính năng cho phép giao diện Web gọi dữ liệu (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. MÁY CHỦ TĨNH: Mở cửa cho trang Web lấy ảnh từ thư mục data/keyframe
app.mount("/images", StaticFiles(directory="data/keyframe"), name="images")

# 3. KHỞI ĐỘNG HỆ THỐNG TRÍ TUỆ NHÂN TẠO
print("1. Đang tải mô hình ngôn ngữ CLIP...")
model_name = "openai/clip-vit-base-patch32"
model = CLIPModel.from_pretrained(model_name)
processor = CLIPProcessor.from_pretrained(model_name)

print("2. Đang nạp ma trận đặc trưng vào FAISS...")
all_features = []
image_paths = []

# Quét tất cả file .npy trong thư mục clip-features-32 của bạn
npy_files = sorted(glob.glob("data/clip-features-32/*.npy"))

if not npy_files:
    print("⚠️ CHÚ Ý: Chưa có file .npy nào trong thư mục data/clip-features-32/")
else:
    for npy_file in npy_files:
        video_name = os.path.basename(npy_file).replace('.npy', '')
        feat = np.load(npy_file).astype("float32")
        all_features.append(feat)
        
        # Ghi chép sổ tay Mapping: ID -> Tên file ảnh
        num_frames = feat.shape[0]
        for frame_idx in range(num_frames):
            img_path = f"{video_name}/{frame_idx:04d}.jpg" 
            image_paths.append(img_path)

    # Nén các file npy nhỏ thành 1 cục khổng lồ và đưa vào FAISS
    features_matrix = np.vstack(all_features)
    faiss.normalize_L2(features_matrix)
    index = faiss.IndexFlatIP(features_matrix.shape[1])
    index.add(features_matrix)
    print(f"-> HỆ THỐNG SẴN SÀNG! Đã nạp thành công {index.ntotal} khung hình vào FAISS.")

# 4. MỞ CỔNG TÌM KIẾM
@app.get("/search")
def search(query: str, top_k: int = 20):
    if not npy_files:
        return {"error": "Chưa có dữ liệu data"}
        
    # Dịch câu tiếng Việt/Anh thành Vector
    inputs = processor(text=[query], return_tensors="pt", padding=True)
    with torch.no_grad():
        text_features = model.get_text_features(**inputs)
    
    # Chuẩn hóa Vector và cho FAISS tìm kiếm
    text_features = text_features.numpy().astype("float32")
    faiss.normalize_L2(text_features)
    distances, indices = index.search(text_features, top_k)
    
    # Lấy đường link ảnh dựa vào Sổ tay Mapping
    results = []
    for idx, score in zip(indices[0], distances[0]):
        exact_filename = image_paths[int(idx)] 
        results.append({
            "id": int(idx),
            "score": float(score),
            "image_url": f"http://localhost:8000/images/{exact_filename}"
        })
    
    return {"query": query, "results": results}