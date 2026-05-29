import { useState, useRef, useEffect, useMemo, ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, Bot, CheckCircle, Edit2, Trash2, AlertCircle, Search, Filter, Download, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogOverlay } from "./ui/dialog";
import { apiClient } from "@/api";
import type { Product } from "@/api/types/product";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { authService } from "../lib/auth";
import { useNavigate } from "react-router-dom";

interface Category {
  id: string;
  name: string;
}

export default function Products() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [aiGeneratedProducts, setAiGeneratedProducts] = useState<Product[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [approvingIds, setApprovingIds] = useState<string[]>([]);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [categoryNameMap, setCategoryNameMap] = useState<Record<string, string>>({});

  // Pagination state (client-side for now as API returns full list)
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filters, setFilters] = useState({
    category_id: '',
    is_active: '',
    source: '',
    minPrice: '',
    maxPrice: '',
  });

  // Applied filters state - only used after clicking Apply
  const [appliedFilters, setAppliedFilters] = useState({
    category_id: '',
    is_active: '',
    source: '',
    minPrice: '',
    maxPrice: '',
  });

  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const searchDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delete confirmation dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [productToDelete, setProductToDelete] = useState<{ id: string; name: string } | null>(null);

  // Use TanStack Query for products
  const shopId = authService.getCurrentShopId();

  const queryParams = useMemo(() => {
    const params: any = {};
    if (appliedSearchQuery) params.search = appliedSearchQuery;
    if (appliedFilters.category_id) params.category_id = appliedFilters.category_id;
    if (appliedFilters.is_active) params.is_active = appliedFilters.is_active === 'active';
    if (appliedFilters.minPrice) params.min_price = appliedFilters.minPrice;
    if (appliedFilters.maxPrice) params.max_price = appliedFilters.maxPrice;
    return params;
  }, [appliedSearchQuery, appliedFilters]);

  const {
    data: allProducts = [],
    isLoading,
    isFetched,
    isError,
    error: queryError,
    refetch: fetchProducts
  } = useQuery({
    queryKey: ["products", shopId, queryParams],
    queryFn: async () => {
      if (!shopId) throw new Error("No shop selected");
      return apiClient.getProducts(queryParams);
    },
    enabled: !!shopId,
    // The axios client already retries 5xx twice with 1s + 2s backoff
    // ([client.ts:159-174]). Layering react-query's default retry: 2 on top
    // produced ~30 s of spinner before the user saw any error — see plan
    // cached-finding-lerdorf.md Phase 3.2. One retry is enough here.
    retry: 1
  });

  // Use TanStack Query for categories — same retry rationale as products above.
  const {
    data: categoriesData = []
  } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiClient.getCategories(),
    retry: 1
  });

  // Build categoryNameMap and categoryMap from categoriesData
  const categoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    categoriesData.forEach((category: Category) => {
      if (category?.name) {
        map[category.name] = category.id;
      }
    });
    return map;
  }, [categoriesData]);

  useEffect(() => {
    if (categoriesData.length) {
      const map: Record<string, string> = {};
      categoriesData.forEach((category: Category) => {
        if (category?.name) {
          map[category.name.trim().toLowerCase()] = category.id;
        }
      });
      setCategoryNameMap(map);
    }
  }, [categoriesData]);

  // Query errors render inline below via `isError + queryError` so we don't
  // mirror them into `error` (which would double-display them in the top banner).

  // Get unique categories list
  const categoriesList = useMemo(() => categoriesData.map((c: Category) => c.name), [categoriesData]);

  // Client-side pagination logic
  const filteredProducts = allProducts; // In future, this could be filtered further if needed before pagination
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const products = filteredProducts.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  // Pagination component
  const Pagination = () => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex justify-center items-center gap-2 mt-6">
        <button
          className="px-3 py-1 rounded border bg-white disabled:opacity-50 text-sm hover:bg-gray-50"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          {t('products.pagination.previous')}
        </button>
        <span className="text-sm text-gray-700">
          {t('products.pagination.pageOf', { current: page, total: totalPages })}
        </span>
        <button
          className="px-3 py-1 rounded border bg-white disabled:opacity-50 text-sm hover:bg-gray-50"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          {t('products.pagination.next')}
        </button>
      </div>
    );
  };

  // Debounce search input - wait 2 seconds after user stops typing
  useEffect(() => {
    // Clear previous timer if exists
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }

    // Set new timer
    searchDebounceTimer.current = setTimeout(() => {
      setAppliedSearchQuery(searchQuery);
    }, 300);

    // Cleanup on unmount or when searchQuery changes
    return () => {
      if (searchDebounceTimer.current) {
        clearTimeout(searchDebounceTimer.current);
      }
    };
  }, [searchQuery]);

  const readFileContent = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
      return file.text();
    }
    throw new Error('Unsupported file type. Please upload CSV, TSV, or TXT files.');
  };

  const mapExtractedProduct = (product: any): Product => {
    return {
      ...product,
      price: typeof product.price === 'number' ? product.price : Number(product.price) || 0,
      aiGenerated: product.aiGenerated ?? product.ai_generated ?? true,
      confidence: product.confidence ?? product.ai_confidence ?? 0,
      status: product.status || 'pending',
      createdAt: product.createdAt || product.created_at || new Date().toISOString(),
      updatedAt: product.updatedAt || product.updated_at || new Date().toISOString(),
    } as Product;
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadProgress(10);

    try {
      const content = await readFileContent(file);
      setUploadProgress(40);
      const result = await apiClient.extractProductsFromUpload({
        filename: file.name,
        content_type: file.type,
        content
      });
      setUploadProgress(90);

      const extracted = result.products.map(mapExtractedProduct);
      if (extracted.length === 0) {
        throw new Error('No products could be extracted from the file.');
      }

      setAiGeneratedProducts(extracted);
      setShowReviewModal(true);
      setShowUploadModal(false);
    } catch (error: any) {
      setError(error.response?.data?.error?.message || error.message || 'Failed to process upload.');
    } finally {
      setUploadProgress(0);
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const buildCreatePayload = (product: Product) => {
    const categoryName = product.category?.trim().toLowerCase() || '';
    const resolvedCategoryId = product.category_id || (categoryName ? categoryNameMap[categoryName] : undefined);
    const payload: any = {
      name: product.name,
      price: product.price,
      sku: product.sku || undefined,
      description: product.description || undefined,
      category: product.category || undefined,
      category_id: resolvedCategoryId,
      tags: Array.isArray(product.tags) ? product.tags : undefined,
      quantity: product.quantity ?? undefined,
      track_quantity: product.quantity !== undefined && product.quantity !== null,
      ai_generated: true,
      confidence: product.confidence ?? undefined,
      brand: product.brand || undefined,
      weight: product.weight ?? undefined,
      weight_unit: product.weight_unit || undefined
    };

    return payload;
  };

  const handleApproveProduct = async (product: Product) => {
    if (!product.price || product.price <= 0) {
      setError(`Please set a valid price for ${product.name} before approving.`);
      return;
    }

    setApprovingIds(prev => [...prev, product.id]);
    try {
      const created = await apiClient.createProduct(buildCreatePayload(product));
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setAiGeneratedProducts(prev => prev.filter(p => p.id !== product.id));
    } catch (error: any) {
      setError(error.response?.data?.error?.message || error.message || 'Failed to approve product.');
    } finally {
      setApprovingIds(prev => prev.filter(id => id !== product.id));
    }
  };

  const handleApproveAll = async () => {
    if (aiGeneratedProducts.length === 0) return;
    setBulkApproving(true);
    setError(null);

    const validProducts = aiGeneratedProducts.filter(product => product.price && product.price > 0);
    const invalidProducts = aiGeneratedProducts.filter(product => !product.price || product.price <= 0);
    if (invalidProducts.length > 0) {
      setError(`Some products have invalid prices and were skipped.`);
    }

    const results = await Promise.allSettled(
      validProducts.map(product =>
        apiClient.createProduct(buildCreatePayload(product))
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ["products"] });
            setAiGeneratedProducts(prev => prev.filter(p => p.id !== product.id));
          })
          .catch(error => {
            setError(error.response?.data?.error?.message || error.message || `Failed to approve ${product.name}.`);
          })
      )
    );

    setBulkApproving(false);
    setShowReviewModal(false);
  };

  const handleEditProduct = (product: Product) => {
    navigate(`/app/products/${product.id}/edit`);
  };

  const handleRejectProduct = (productId: string) => {
    setAiGeneratedProducts(aiGeneratedProducts.filter(p => p.id !== productId));
  };

  const handleDeleteProduct = async (productId: string) => {
    // Find product to get its name for confirmation dialog
    const product = products.find(p => p.id === productId);
    if (product) {
      setProductToDelete({ id: productId, name: product.name });
      setShowDeleteConfirm(true);
    }
  };

  const confirmDelete = async () => {
    if (!productToDelete) return;

    try {
      await apiClient.deleteProduct(productToDelete.id);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setShowDeleteConfirm(false);
      setProductToDelete(null);
      toast.success(t('products.deleteModal.success'));
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('products.deleteModal.failed'));
      setShowDeleteConfirm(false);
      setProductToDelete(null);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setProductToDelete(null);
  };

  const handleDownloadTemplate = () => {
    const csvContent = [
      'name,price,sku,category,description,brand,weight,weight_unit,quantity,variants',
      'Example Product,100,SKU-001,Electronics,A great product,BrandName,0.5,kg,10,"Color: Red|Blue"',
      'Another Product,250,SKU-002,Clothing,Nice shirt,FashionCo,0.3,kg,25,"Size: S|M|L|XL"',
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'product-upload-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const applyFilters = () => {
    setShowFilterPanel(false);
    // Copy filters to applied filters to trigger fetch
    setAppliedFilters({
      category_id: filters.category_id,
      is_active: filters.is_active,
      source: filters.source,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
    });
  };

  const clearFilters = () => {
    // Reset both filter states
    setFilters({
      category_id: '',
      is_active: '',
      source: '',
      minPrice: '',
      maxPrice: '',
    });
    setSearchQuery('');
    setAppliedFilters({
      category_id: '',
      is_active: '',
      source: '',
      minPrice: '',
      maxPrice: '',
    });
    setAppliedSearchQuery('');
  };

  return (
    <div className="p-4 md:p-8">
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {isError && !isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <AlertCircle className="h-8 w-8 text-red-600" />
          <p className="text-gray-700">{queryError instanceof Error ? queryError.message : t('products.loadError', 'Could not load products. Please try again.')}</p>
          <button
            onClick={() => fetchProducts()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-600">{t('products.loading')}</span>
        </div>
      ) : isFetched && allProducts.length === 0 && !appliedSearchQuery && !appliedFilters.category_id && !appliedFilters.is_active && !appliedFilters.minPrice && !appliedFilters.maxPrice ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white rounded-xl border border-dashed border-gray-300">
          <Bot className="h-12 w-12 text-gray-300" />
          <div className="text-center max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('products.emptyTitle', 'No products yet')}</h3>
            <p className="text-sm text-gray-500">{t('products.emptySubtitle', 'Upload a CSV with your catalog or add your first product manually to get started.')}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              <Upload className="w-5 h-5" />
              {t('products.uploadFile')}
            </button>
            <button
              onClick={() => navigate('/app/products/add')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-5 h-5" />
              {t('products.addManually')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-6 md:mb-8 gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('products.title')}</h1>
              <p className="text-gray-600 mt-1 text-sm md:text-base">{t('products.subtitle')}</p>
            </div>
            <div className="flex gap-3">
              <div className="relative">
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  <Upload className="w-5 h-5" />
                  {t('products.uploadFile')}
                </button>
                <button
                  onClick={handleDownloadTemplate}
                  className="absolute -bottom-6 right-0 text-xs text-purple-600 hover:text-purple-700 hover:underline whitespace-nowrap"
                >
                  {t('products.downloadTemplate')}
                </button>
              </div>
              <button
                onClick={() => navigate('/app/products/add')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-5 h-5" />
                {t('products.addManually')}
              </button>
            </div>

          </div>
          {totalPages > 1 && <Pagination />}

          {/* Search and Filter Toolbar */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="flex-1 min-w-[300px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('products.searchPlaceholder')}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filter Button */}
            <div className="relative">
              <button
                onClick={() => setShowFilterPanel(!showFilterPanel)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                <Filter className="w-5 h-5" />
                {t('products.filter')}
                {(appliedFilters.category_id || appliedFilters.is_active || appliedFilters.source || appliedFilters.minPrice || appliedFilters.maxPrice) && (
                  <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                )}
              </button>

              {/* Filter Panel */}
              {showFilterPanel && (
                <div className="absolute top-full mt-2 right-0 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg z-10 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">{t('products.filterTitle')}</h3>
                    <button
                      onClick={() => setShowFilterPanel(false)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Category Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('products.filterCategory')}
                      </label>
                      <select
                        value={filters.category_id}
                        onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">{t('products.allCategories')}</option>
                        {categoriesList.map(catName => (
                          <option key={categoryMap[catName]} value={categoryMap[catName]}>{catName}</option>
                        ))}
                      </select>
                    </div>

                    {/* Status Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('products.filterStatus')}
                      </label>
                      <select
                        value={filters.is_active}
                        onChange={(e) => setFilters({ ...filters, is_active: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">{t('products.allStatus')}</option>
                        <option value="active">{t('products.statusActive')}</option>
                        <option value="inactive">{t('products.statusInactive')}</option>
                      </select>
                    </div>

                    {/* Source Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('products.filterSource')}
                      </label>
                      <select
                        value={filters.source}
                        onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">{t('products.allSources')}</option>
                        <option value="ai">{t('products.sourceAI')}</option>
                        <option value="manual">{t('products.sourceManual')}</option>
                      </select>
                    </div>

                    {/* Price Range Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('products.filterPrice')}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={filters.minPrice}
                          onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
                          placeholder={t('products.priceMin')}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          step="0.01"
                          min="0"
                        />
                        <span className="text-gray-500">–</span>
                        <input
                          type="number"
                          value={filters.maxPrice}
                          onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                          placeholder={t('products.priceMax')}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          step="0.01"
                          min="0"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200">
                    <button
                      onClick={clearFilters}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                    >
                      {t('common.clear')}
                    </button>
                    <button
                      onClick={applyFilters}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      {t('common.apply')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Products Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.product')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.sku')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.price')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.quantity')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.category')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.variants')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.status')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.source')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{t('products.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{product.name}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{product.sku}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">৳{product.price}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {product.track_quantity ? product.quantity || 0 : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{product.category}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {product.variants && Array.isArray(product.variants) && product.variants.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {product.variants.map((variant, idx) => (
                            <span key={idx} className="inline-block px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded">
                              {typeof variant === 'object' ? variant.name || variant : variant}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">{t('products.noVariants')}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-sm ${product.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : product.status === 'inactive'
                          ? 'bg-gray-100 text-gray-700'
                          : 'bg-yellow-100 text-yellow-700'
                        }`}>
                        {product.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {product.aiGenerated ? (
                        <div className="flex items-center gap-1 text-sm text-purple-600">
                          <Bot className="w-4 h-4" />
                          <span>{t('products.aiSource', { confidence: Math.round((product.confidence || 0) * 100) })}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">{t('products.sourceManual')}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEditProduct(product)}
                          aria-label={`Edit ${product.name}`}
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          aria-label={`Delete ${product.name}`}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Upload Modal */}
          {showUploadModal && (
            <div
              className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4"
              onKeyDown={(e) => { if (e.key === 'Escape') setShowUploadModal(false); }}
              onClick={(e) => { if (e.target === e.currentTarget) setShowUploadModal(false); }}
            >
              <div className="bg-white rounded-xl p-4 md:p-8 max-w-lg w-full">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('products.uploadModal.title')}</h2>
                <p className="text-gray-600 mb-6">{t('products.uploadModal.description')}</p>

                {uploadProgress === 0 ? (
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600 mb-4">{t('products.uploadModal.dragDrop')}</p>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      accept=".csv,.xlsx,.xls,.pdf,.txt,.doc,.docx"
                      className="hidden"
                      id="file-upload"
                    />
                    <label
                      htmlFor="file-upload"
                      className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
                    >
                      {t('products.uploadModal.chooseFile')}
                    </label>
                    <p className="text-sm text-gray-500 mt-4">{t('products.uploadModal.supported')}</p>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                        <span>{t('products.uploadModal.processing')}</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 text-center">
                      {t('products.uploadModal.extracting')}
                    </p>
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadProgress(0);
                    }}
                    className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Review AI Products Modal */}
          {showReviewModal && aiGeneratedProducts.length > 0 && (
            <div
              className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 overflow-y-auto"
              onKeyDown={(e) => { if (e.key === 'Escape') setShowReviewModal(false); }}
              onClick={(e) => { if (e.target === e.currentTarget) setShowReviewModal(false); }}
            >
              <div className="bg-white rounded-xl p-4 md:p-8 max-w-4xl w-full my-4 md:my-8">
                <div className="flex items-center gap-3 mb-6">
                  <Bot className="w-8 h-8 text-purple-600" />
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{t('products.reviewModal.title')}</h2>
                    <p className="text-gray-600">{t('products.reviewModal.description')}</p>
                  </div>
                </div>

                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {aiGeneratedProducts.map((product) => (
                    <div key={product.id} className="border-2 border-purple-200 rounded-lg p-4 bg-purple-50">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-gray-900">{product.name}</h3>
                            <span className="px-2 py-1 bg-purple-200 text-purple-700 text-xs rounded">
                              Confidence: {Math.round((product.confidence || 0) * 100)}%
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600">SKU:</span>
                              <span className="ml-2 text-gray-900">{product.sku}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Price:</span>
                              <span className="ml-2 text-gray-900">৳{product.price}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Category:</span>
                              <span className="ml-2 text-gray-900">{product.category}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Variants:</span>
                              <span className="ml-2 text-gray-900">{product.variants?.join(', ')}</span>
                            </div>
                          </div>
                          {product.aliases && (
                            <div className="mt-2 text-sm">
                              <span className="text-gray-600">Aliases:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {product.aliases.map((alias, i) => (
                                  <span key={i} className="px-2 py-1 bg-white text-gray-700 text-xs rounded border border-purple-200">
                                    {alias}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditProduct(product)}
                          className="flex items-center gap-1 px-3 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-100 text-sm"
                        >
                          <Edit2 className="w-4 h-4" />
                          {t('common.edit')}
                        </button>
                        <button
                          onClick={() => handleApproveProduct(product)}
                          disabled={approvingIds.includes(product.id)}
                          className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                        >
                          <CheckCircle className="w-4 h-4" />
                          {approvingIds.includes(product.id) ? t('common.approving') : t('common.approve')}
                        </button>
                        <button
                          onClick={() => handleRejectProduct(product.id)}
                          className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                        >
                          <AlertCircle className="w-4 h-4" />
                          {t('common.reject')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowReviewModal(false)}
                    className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    {t('common.close')}
                  </button>
                  <button
                    onClick={handleApproveAll}
                    disabled={bulkApproving}
                    className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {bulkApproving ? t('common.approving') : t('products.reviewModal.approveAll')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Confirmation Dialog (Radix) */}
          <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <DialogOverlay />
            <DialogContent className="max-w-sm w-full mx-4">
              <DialogHeader>
                <DialogTitle>{t('products.deleteModal.title')}</DialogTitle>
                <DialogDescription>
                  {t('products.deleteModal.description', { name: productToDelete?.name })}
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-3 mt-6">
                <button onClick={cancelDelete} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
                <button onClick={confirmDelete} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">{t('common.delete')}</button>
              </div>
            </DialogContent>
          </Dialog>

        </>
      )}
    </div>
  );
}