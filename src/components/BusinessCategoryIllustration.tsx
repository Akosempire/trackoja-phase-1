import type { BusinessCategory } from '../config/businessModules';
import restaurant from '../assets/business-categories/restaurant.png';
import tailor from '../assets/business-categories/tailor.png';
import fashion_store from '../assets/business-categories/fashion_store.png';
import fabric_textile from '../assets/business-categories/fabric_textile.png';
import supermarket from '../assets/business-categories/supermarket.png';
import pharmacy from '../assets/business-categories/pharmacy.png';
import electronics_gadget from '../assets/business-categories/electronics_gadget.png';
import beauty_cosmetics from '../assets/business-categories/beauty_cosmetics.png';
import building_materials from '../assets/business-categories/building_materials.png';
import stationery from '../assets/business-categories/stationery.png';
import general_retail from '../assets/business-categories/general_retail.png';
import other from '../assets/business-categories/other.png';

const illustrations: Record<BusinessCategory, string> = {
  restaurant,
  tailor,
  fashion_store,
  fabric_textile,
  supermarket,
  pharmacy,
  electronics_gadget,
  beauty_cosmetics,
  building_materials,
  stationery,
  general_retail,
  other,
};

// Bounds of the visible object at alpha >= 220, excluding transparent padding/shadows.
// Keep this metadata with its PNG; regenerate it if the illustration is replaced.
const artworkBounds: Record<BusinessCategory, { width: number; height: number; left: number; top: number; right: number; bottom: number }> = {
  restaurant: { width: 1536, height: 1024, left: 330, top: 198, right: 1209, bottom: 825 },
  tailor: { width: 1374, height: 1145, left: 437, top: 224, right: 1120, bottom: 910 },
  fashion_store: { width: 1214, height: 1295, left: 130, top: 123, right: 1084, bottom: 1175 },
  fabric_textile: { width: 1370, height: 1148, left: 279, top: 167, right: 1092, bottom: 963 },
  supermarket: { width: 1374, height: 1145, left: 282, top: 158, right: 1109, bottom: 1043 },
  pharmacy: { width: 1374, height: 1145, left: 270, top: 207, right: 1153, bottom: 929 },
  electronics_gadget: { width: 1236, height: 1273, left: 377, top: 227, right: 859, bottom: 1054 },
  beauty_cosmetics: { width: 1024, height: 1536, left: 357, top: 149, right: 670, bottom: 1368 },
  building_materials: { width: 1374, height: 1145, left: 274, top: 105, right: 1188, bottom: 1036 },
  stationery: { width: 1254, height: 1254, left: 224, top: 246, right: 1039, bottom: 1048 },
  general_retail: { width: 1536, height: 1024, left: 423, top: 224, right: 1113, bottom: 816 },
  other: { width: 1402, height: 1122, left: 267, top: 207, right: 1135, bottom: 915 },
};

/** Decorative artwork: the adjacent category label supplies the accessible name. */
export function BusinessCategoryIllustration({ category, compact = false }: { category: BusinessCategory; compact?: boolean }) {
  const bounds = artworkBounds[category];
  // Fit the actual object into 78% of the square, then center its visible bounds.
  // Percentage geometry also applies to the compact selected-category badge.
  const scale = 78 / Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top);
  const imageStyle = {
    width: `${bounds.width * scale}%`,
    height: `${bounds.height * scale}%`,
    left: `${50 - (bounds.left + bounds.right) * scale / 2}%`,
    top: `${50 - (bounds.top + bounds.bottom) * scale / 2}%`,
  };
  return (
    <span className={`business-category-frame${compact ? ' is-compact' : ''}`} aria-hidden="true" data-category={category}>
      <img src={illustrations[category]} alt="" draggable={false} decoding="async" width={bounds.width} height={bounds.height} className="business-category-illustration" style={imageStyle} />
    </span>
  );
}
