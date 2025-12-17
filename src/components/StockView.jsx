import React, { useState, useRef } from 'react';
import { Camera as CameraIcon, FileText, Upload, Check, AlertCircle, ScanLine, ArrowRight, Loader2, Save, X } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { uploadVisionImage } from '../services/api';
import { cn } from '../lib/utils';
import { LocalStorageService } from '../services/LocalStorageService';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

const StockView = () => {
    const { refreshInventory, inventory } = useAppData();
    const [activeTab, setActiveTab] = useState('bill'); // 'bill' or 'shelf'
    const [image, setImage] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [parsedData, setParsedData] = useState(null); // Matched items
    const [missingItems, setMissingItems] = useState([]); // Items not found in inventory
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);

    // Fallback refs for web
    const fileInputRef = useRef(null);
    const cameraInputRef = useRef(null);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            processFile(file);
        }
    };

    const processFile = (file) => {
        setImage(file);
        setPreviewUrl(URL.createObjectURL(file));
        setParsedData(null);
        setMissingItems([]);
        setError(null);
        setSuccessMessage(null);
    };

    // Native Camera Handler
    const handleNativeCamera = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.Uri,
                source: CameraSource.Camera
            });

            // Convert webPath to Blob/File
            const response = await fetch(image.webPath);
            const blob = await response.blob();
            const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });

            processFile(file);
        } catch (err) {
            console.error("Camera cancelled or failed", err);
            // Don't set error if just cancelled
            if (err.message !== 'User cancelled photos app') {
                setError("Camera failed to open.");
            }
        }
    };

    // Native Gallery Handler
    const handleNativeGallery = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.Uri,
                source: CameraSource.Photos
            });

            // Convert webPath to Blob/File
            const response = await fetch(image.webPath);
            const blob = await response.blob();
            const file = new File([blob], `gallery_${Date.now()}.jpg`, { type: 'image/jpeg' });

            processFile(file);
        } catch (err) {
            console.error("Gallery cancelled or failed", err);
            if (err.message !== 'User cancelled photos app') {
                setError("Gallery failed to open.");
            }
        }
    };

    // Unified Handlers
    const onUploadClick = () => {
        if (Capacitor.isNativePlatform()) {
            handleNativeGallery();
        } else {
            fileInputRef.current?.click();
        }
    };

    const onCameraClick = () => {
        if (Capacitor.isNativePlatform()) {
            handleNativeCamera();
        } else {
            cameraInputRef.current?.click();
        }
    };

    const processImage = async () => {
        if (!image) return;
        setLoading(true);
        setError(null);
        setMissingItems([]);
        try {
            // Determine type based on active tab
            const type = activeTab === 'bill' ? 'ocr' : 'shelf';

            // Call API
            const result = await uploadVisionImage(image, type);
            let rawItems = [];

            // Handle different API response structures
            console.log("Vision API Result:", result); // Debug logging

            if (result.products) {
                rawItems = result.products;
            } else if (result.data) {
                // Fix: Handle case where API returns stringified JSON in 'data' field
                try {
                    rawItems = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;

                    // Check for validation error from backend
                    if (rawItems.error) {
                        setError(rawItems.error);
                        setLoading(false);
                        return;
                    }
                } catch (e) {
                    console.error("Failed to parse result.data", e);
                    rawItems = [];
                }
            } else if (Array.isArray(result)) {
                rawItems = result;
            }

            // Normalization: Map API 'shelf' to UI 'position' if needed
            rawItems = rawItems.map(item => ({
                ...item,
                position: item.position || item.shelf // Fix: API returns 'shelf', UI expects 'position'
            }));

            // Filtering Logic
            const matched = [];
            const missing = [];

            // Get current inventory names for robust matching
            // We use 'inventory' from context which we already have, but LocalStorageService is direct source of truth
            const currentInventory = LocalStorageService.getInventory();

            rawItems.forEach(item => {
                const itemName = (item.name || '').toLowerCase();
                // Check if exists in inventory
                const exists = currentInventory.find(p => {
                    // Check logic: string name or localized name object
                    const pName = p.name;
                    if (typeof pName === 'string') {
                        const existingName = pName.toLowerCase();
                        // BIDIRECTIONAL CHECK: "Rice" in "Rice 1kg" OR "Rice 1kg" in "Rice"
                        return existingName.includes(itemName) || itemName.includes(existingName);
                    } else if (typeof pName === 'object') {
                        return Object.values(pName).some(v => {
                            const val = v.toLowerCase();
                            return val.includes(itemName) || itemName.includes(val);
                        });
                    }
                    return false;
                });

                if (exists) {
                    matched.push({ ...item, productId: exists.id });
                } else {
                    missing.push(item);
                }
            });

            setParsedData(matched);
            setMissingItems(missing);

        } catch (err) {
            console.error("Processing failed", err);
            setError("Failed to process image. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async () => {
        setLoading(true);
        try {
            if (activeTab === 'bill') {
                // Update Inventory logic for MATCHED items only
                const currentInventory = LocalStorageService.getInventory();

                parsedData.forEach(item => {
                    if (item.productId) {
                        const existingProduct = currentInventory.find(p => p.id === item.productId);
                        if (existingProduct) {
                            // Update stock and price
                            const newStock = (parseInt(existingProduct.stock) || 0) + (parseInt(item.quantity) || 0);
                            LocalStorageService.updateProduct(item.productId, {
                                stock: newStock,
                                price: item.price || existingProduct.price
                            });
                        }
                    }
                    // Ignored items are already in 'missingItems' state and warned about
                });
                setSuccessMessage("Inventory updated successfully for matched items!");
            } else {
                // Shelf Position update logic
                parsedData.forEach(item => {
                    if (item.productId) {
                        LocalStorageService.updateProduct(item.productId, {
                            shelf_position: item.position
                        });
                    }
                });
                setSuccessMessage("Shelf positions updated successfully for matched items!");
            }

            await refreshInventory(true);
            setParsedData(null);
            setMissingItems([]);
            setImage(null);
            setPreviewUrl(null);
        } catch (err) {
            console.error("Update failed", err);
            setError("Failed to update database.");
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveItem = (indexToRemove) => {
        setParsedData(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const handleCancelAll = () => {
        setParsedData(null);
        setMissingItems([]);
        setImage(null);
        setPreviewUrl(null);
        setError(null);
        setSuccessMessage(null);
    };

    return (
        <div className="space-y-6 pb-40 md:pb-0">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Stock Management</h1>
                <p className="text-muted-foreground">Manage inventory via invoices and shelf scans.</p>
            </div>

            {/* Tabs */}
            <div className="bg-muted p-1 rounded-xl inline-flex">
                <button
                    onClick={() => { setActiveTab('bill'); handleCancelAll(); }}
                    className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
                        activeTab === 'bill' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <FileText className="w-4 h-4" />
                    Bill of Lading
                </button>
                <button
                    onClick={() => { setActiveTab('shelf'); handleCancelAll(); }}
                    className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
                        activeTab === 'shelf' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <ScanLine className="w-4 h-4" />
                    Shelf Scan
                </button>
            </div>

            {/* Main Content Area */}
            <div className="grid gap-6 md:grid-cols-2">
                {/* Upload Section */}
                <div className="bg-card p-6 rounded-2xl shadow-sm border border-border">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        {activeTab === 'bill' ? "Upload Invoice" : "Capture Shelf"}
                    </h3>

                    <div
                        onClick={onUploadClick}
                        className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:bg-muted/50 transition-colors relative overflow-hidden group min-h-[300px] cursor-pointer"
                    >
                        {/* Hidden Inputs (Web Fallback) */}
                        <input
                            type="file"
                            accept="image/*"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: 'none' }}
                        />
                        <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            ref={cameraInputRef}
                            onChange={handleFileChange}
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: 'none' }}
                        />

                        {previewUrl ? (
                            <div className="relative w-full h-64" onClick={(e) => e.stopPropagation()}>
                                <img src={previewUrl} alt="Preview" className="w-full h-full object-contain rounded-lg" />
                                <button
                                    onClick={(e) => { e.stopPropagation(); setPreviewUrl(null); }}
                                    className="absolute top-2 right-2 bg-black/60 text-white p-2 rounded-full hover:bg-black/80"
                                >
                                    <span className="sr-only">Remove</span>
                                    ×
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-4 w-full">
                                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    {activeTab === 'bill' ? <FileText className="w-8 h-8" /> : <CameraIcon className="w-8 h-8" />}
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-foreground">Click to upload or drag and drop</p>
                                    <p className="text-xs text-muted-foreground">Supports JPG, PNG</p>
                                </div>

                                <div className="flex flex-wrap gap-3 justify-center w-full mt-4">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onUploadClick(); }}
                                        className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                                    >
                                        <Upload className="w-4 h-4" />
                                        Upload File
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onCameraClick(); }}
                                        className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                                    >
                                        <CameraIcon className="w-4 h-4" />
                                        Take Photo
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={processImage}
                            disabled={!image || loading}
                            className={cn(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100",
                                !image || loading ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/25"
                            )}
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Process Image"}
                        </button>
                    </div>
                </div>

                {/* Results Section */}
                <div className="space-y-4">
                    {/* Instructions / Empty State */}
                    {!parsedData && missingItems.length === 0 && !loading && !error && !successMessage && (
                        <div className="bg-card p-6 rounded-2xl shadow-sm border border-border h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                            <AlertCircle className="w-12 h-12 mb-3 opacity-20" />
                            <p>Upload an image to see recognized data.</p>
                        </div>
                    )}

                    {/* Missing Items Warning */}
                    {missingItems.length > 0 && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 animate-in fade-in slide-in-from-bottom-2">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-semibold text-yellow-800">New Items Detected</h4>
                                    <p className="text-sm text-yellow-700 mt-1">
                                        The following items were found in the image but are not in your inventory.
                                        Please add them manually first:
                                    </p>
                                    <ul className="mt-2 space-y-1">
                                        {missingItems.map((item, idx) => (
                                            <li key={idx} className="text-sm font-medium text-yellow-900 flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                                                {item.name}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Success/Error Messages */}
                    {error && (
                        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}
                    {successMessage && (
                        <div className="bg-green-500/10 text-green-600 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2">
                            <Check className="w-4 h-4" />
                            {successMessage}
                        </div>
                    )}

                    {/* Parsed Data Table */}
                    {parsedData && parsedData.length > 0 && (
                        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden flex flex-col md:h-full animate-in fade-in slide-in-from-bottom-2">
                            <div className="p-4 border-b border-border bg-muted/30">
                                <h3 className="font-semibold">Matched Items ({parsedData.length})</h3>
                            </div>
                            <div className="overflow-y-auto max-h-[400px]">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-muted-foreground bg-muted/50">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Item</th>
                                            {activeTab === 'bill' ? (
                                                <>
                                                    <th className="px-4 py-3 font-medium text-right">Qty</th>
                                                    <th className="px-4 py-3 font-medium text-right">Price</th>
                                                </>
                                            ) : (
                                                <th className="px-4 py-3 font-medium text-right">Position</th>
                                            )}
                                            <th className="px-4 py-3 font-medium text-center w-10">Act</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {parsedData.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                                <td className="px-4 py-3 font-medium">{item.name}</td>
                                                {activeTab === 'bill' ? (
                                                    <>
                                                        <td className="px-4 py-3 text-right text-muted-foreground">{item.quantity}</td>
                                                        <td className="px-4 py-3 text-right font-medium">₹{item.price}</td>
                                                    </>
                                                ) : (
                                                    <td className="px-4 py-3 text-right font-mono text-primary bg-primary/5 rounded px-2 w-fit">{item.position}</td>
                                                )}
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={() => handleRemoveItem(idx)}
                                                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="p-4 border-t border-border mt-auto bg-muted/30 flex gap-3">
                                <button
                                    onClick={handleCancelAll}
                                    className="flex-1 flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-foreground py-3 rounded-xl font-medium transition-all text-sm border border-border"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleUpdate}
                                    disabled={loading}
                                    className="flex-[2] flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-medium shadow-lg shadow-green-600/20 active:scale-95 transition-all text-sm"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    {activeTab === 'bill' ? "Update Inventory" : "Update Positions"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {/* Mobile Spacer to clear bottom nav */}
            <div className="h-64 md:hidden" />
        </div>
    );
};

export default StockView;
