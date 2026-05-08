import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Upload, Plus, Eye, Edit2, Trash2, X } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { apiClient } from "@/api";

interface SubSubcategory {
  id: string;
  name: string;
  image: string;
  description?: string;
}

export default function SubcategoryDetails() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { categoryId, subcategoryId } = useParams();

  const [subcategoryName, setSubcategoryName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryImage, setCategoryImage] = useState("");
  const [bannerImage, setBannerImage] = useState("");
  const [subSubcategories, setSubSubcategories] = useState<SubSubcategory[]>([]);
  const [parentCategoryName, setParentCategoryName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<SubSubcategory | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<SubSubcategory | null>(null);

  useEffect(() => {
    const loadDetails = async () => {
      if (!categoryId || !subcategoryId) return;
      try {
        setIsLoading(true);
        setLoadError(null);

        const [parentCategory, subcategory] = await Promise.all([
          apiClient.getCategory(categoryId),
          apiClient.getSubcategoryDetails(categoryId, subcategoryId)
        ]);

        setParentCategoryName(parentCategory?.name || null);
        setSubcategoryName(subcategory?.name || '');
        setDescription(subcategory?.description || '');
        setCategoryImage(subcategory?.image || '');
        setBannerImage(subcategory?.cover_image || '');

        const children = (subcategory?.subcategories || []).map((child: any) => ({
          id: child.id,
          name: child.name,
          image: child.image || child.cover_image || '',
          description: child.description || ''
        }));

        setSubSubcategories(children);
      } catch (error: any) {
        setLoadError(error.response?.data?.error?.message || 'Failed to load subcategory details');
      } finally {
        setIsLoading(false);
      }
    };

    loadDetails();
  }, [categoryId, subcategoryId]);

  const handleCategoryImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCategoryImage(URL.createObjectURL(file));
    }
  };

  const handleBannerImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBannerImage(URL.createObjectURL(file));
    }
  };

  const handleUpdate = async () => {
    if (!subcategoryId) return;
    try {
      setIsSaving(true);
      setSaveError(null);
      setSaveSuccess(null);

      await apiClient.updateCategory(subcategoryId, {
        name: subcategoryName,
        description,
        image: categoryImage,
        cover_image: bannerImage,
      });

      setSaveSuccess('Subcategory updated successfully.');
      setTimeout(() => setSaveSuccess(null), 2500);
    } catch (error: any) {
      setSaveError(error.response?.data?.error?.message || 'Failed to update subcategory');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdd = () => {
    setEditingItem(null);
    setShowModal(true);
  };

  const handleEdit = (item: SubSubcategory) => {
    setEditingItem(item);
    setShowModal(true);
  };

  const handleDelete = (item: SubSubcategory) => {
    setItemToDelete(item);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      setSubSubcategories(subSubcategories.filter(s => s.id !== itemToDelete.id));
      setShowDeleteModal(false);
      setItemToDelete(null);
    }
  };

  return (
    <div className="p-4 md:p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6 flex-wrap">
        <button onClick={() => navigate("/app/categories")} className="hover:text-gray-900">
          {t('categories.subcategoryDetail.breadcrumb')}
        </button>
        <ChevronRight className="w-4 h-4" />
        <button onClick={() => navigate(`/categories/${categoryId}`)} className="hover:text-gray-900">
          {parentCategoryName || 'Category'}
        </button>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900">{subcategoryName}</span>
      </div>

      {isLoading && (
        <div className="mb-6 text-gray-500">{t('categories.subcategoryDetail.loading')}</div>
      )}
      {loadError && (
        <div className="mb-6 text-red-600">{loadError}</div>
      )}
      {saveError && (
        <div className="mb-6 text-red-600">{saveError}</div>
      )}
      {saveSuccess && (
        <div className="mb-6 text-green-600">{saveSuccess}</div>
      )}

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('categories.subcategoryDetail.title')}</h1>
        <p className="text-sm md:text-base text-gray-600 mt-1">{t('categories.subcategoryDetail.subtitle')}</p>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left Panel - Subcategory Form */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('categories.subcategoryDetail.infoSection')}</h2>

          <div className="space-y-6">
            {/* Banner Image */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('categories.subcategoryDetail.bannerImage')}
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden">
                {bannerImage ? (
                  <div className="relative group">
                    <img
                      src={bannerImage}
                      alt="Banner"
                      className="w-full h-48 object-cover"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <label className="cursor-pointer px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-100">
                        {t('categories.subcategoryDetail.changeImage')}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleBannerImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-48 cursor-pointer hover:bg-gray-50">
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-600">{t('categories.subcategoryDetail.uploadBanner')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleBannerImageUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">{t('categories.subcategoryDetail.bannerHint')}</p>
            </div>

            {/* Category Image */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('categories.subcategoryDetail.subcategoryImage')}
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden">
                {categoryImage ? (
                  <div className="relative group">
                    <img
                      src={categoryImage}
                      alt="Subcategory"
                      className="w-full aspect-square object-cover"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <label className="cursor-pointer px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-100">
                        {t('categories.subcategoryDetail.changeImage')}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleCategoryImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center aspect-square cursor-pointer hover:bg-gray-50">
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-600">{t('categories.subcategoryDetail.uploadImage')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleCategoryImageUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">{t('categories.subcategoryDetail.imageHint')}</p>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('categories.subcategoryDetail.nameLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subcategoryName}
                onChange={(e) => setSubcategoryName(e.target.value)}
                maxLength={50}
                placeholder={t('categories.subcategoryDetail.namePlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">{t('categories.subcategoryDetail.charCount', { count: subcategoryName.length })}</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('categories.subcategoryDetail.shortDesc')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder={t('categories.subcategoryDetail.shortDescPlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Update Button */}
            <button
              onClick={handleUpdate}
              disabled={isSaving}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? t('common.saving') : t('categories.subcategoryDetail.updateButton')}
            </button>
          </div>
        </div>

        {/* Right Panel - Nested Subcategories */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">{t('categories.subcategoryDetail.nestedSection')}</h2>
            <button
              onClick={handleAdd}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              {t('categories.subcategoryDetail.addNested')}
            </button>
          </div>

          {subSubcategories.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Plus className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t('categories.subcategoryDetail.noNested')}</h3>
              <p className="text-gray-600 mb-6">{t('categories.subcategoryDetail.noNestedHint')}</p>
              <button
                onClick={handleAdd}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                {t('categories.subcategoryDetail.addNestedButton')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {subSubcategories.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-16 h-16 rounded-lg object-cover border border-gray-200"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {item.description && (
                      <div className="text-sm text-gray-500 truncate">{item.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => navigate(`/categories/${categoryId}/${subcategoryId}/${item.id}`)}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                      title={t('categories.subcategoryDetail.viewDetails')}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleEdit(item)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                      title={t('common.edit')}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <NestedModal
          item={editingItem}
          onClose={() => setShowModal(false)}
          onSave={(data) => {
            if (editingItem) {
              setSubSubcategories(subSubcategories.map(s =>
                s.id === editingItem.id ? { ...s, ...data } : s
              ));
            } else {
              setSubSubcategories([...subSubcategories, {
                id: `ss${Date.now()}`,
                ...data
              }]);
            }
            setShowModal(false);
          }}
        />
      )}

      {/* Delete Modal */}
      {showDeleteModal && itemToDelete && (
        <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t('categories.subcategoryDetail.deleteTitle')}</h3>
            <p className="text-gray-600 mb-6">
              {t('categories.subcategoryDetail.deleteMsg', { name: itemToDelete.name })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Nested Modal Component
function NestedModal({
  item,
  onClose,
  onSave
}: {
  item: SubSubcategory | null;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [image, setImage] = useState(item?.image || "");
  const [banner, setBanner] = useState("");

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImage(URL.createObjectURL(file));
    }
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBanner(URL.createObjectURL(file));
    }
  };

  const handleSubmit = () => {
    onSave({ name, description, image, banner });
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">
            {item ? t('common.edit') : t('categories.subcategoryDetail.addNested')}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Banner Image */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('categories.subcategoryDetail.bannerImage')}
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden">
              {banner ? (
                <div className="relative group">
                  <img src={banner} alt="Banner" className="w-full h-40 object-cover" />
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <label className="cursor-pointer px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-100">
                      Change
                      <input type="file" accept="image/*" onChange={handleBannerUpload} className="hidden" />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-40 cursor-pointer hover:bg-gray-50">
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">Upload banner</span>
                  <input type="file" accept="image/*" onChange={handleBannerUpload} className="hidden" />
                </label>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">1300 × 380 pixels, max 4MB</p>
          </div>

          {/* Category Image */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('categories.subcategoryDetail.subcategoryImage')}
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden max-w-xs">
              {image ? (
                <div className="relative group">
                  <img src={image} alt="Category" className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <label className="cursor-pointer px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-100">
                      Change
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center aspect-square cursor-pointer hover:bg-gray-50">
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">{t('categories.subcategoryDetail.uploadImage')}</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              )}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('categories.subcategoryDetail.nameLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('categories.subcategoryDetail.shortDesc')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t('categories.subcategoryDetail.shortDescPlaceholder')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="border-t border-gray-200 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {item ? t('common.update') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  );
}
