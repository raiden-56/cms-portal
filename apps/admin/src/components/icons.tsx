import type { SvgIconProps } from '@mui/material/SvgIcon';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import AlternateEmailOutlined from '@mui/icons-material/AlternateEmailOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import AttachFileOutlined from '@mui/icons-material/AttachFileOutlined';
import BarChartOutlined from '@mui/icons-material/BarChartOutlined';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BookmarkBorderOutlined from '@mui/icons-material/BookmarkBorderOutlined';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import CallToActionOutlined from '@mui/icons-material/CallToActionOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import CheckBoxOutlined from '@mui/icons-material/CheckBoxOutlined';
import CodeOutlined from '@mui/icons-material/CodeOutlined';
import CollectionsOutlined from '@mui/icons-material/CollectionsOutlined';
import ContactMailOutlined from '@mui/icons-material/ContactMailOutlined';
import DataObjectOutlined from '@mui/icons-material/DataObjectOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import DynamicFeedOutlined from '@mui/icons-material/DynamicFeedOutlined';
import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined';
import FingerprintOutlined from '@mui/icons-material/FingerprintOutlined';
import FolderCopyOutlined from '@mui/icons-material/FolderCopyOutlined';
import FormatQuoteOutlined from '@mui/icons-material/FormatQuoteOutlined';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import HelpOutlineOutlined from '@mui/icons-material/HelpOutlineOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import InsertLinkOutlined from '@mui/icons-material/InsertLinkOutlined';
import InventoryOutlined from '@mui/icons-material/Inventory2Outlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import LabelOutlined from '@mui/icons-material/LabelOutlined';
import LayersOutlined from '@mui/icons-material/LayersOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import ListAltOutlined from '@mui/icons-material/ListAltOutlined';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import NavigateNextOutlined from '@mui/icons-material/NavigateNextOutlined';
import NotesOutlined from '@mui/icons-material/NotesOutlined';
import NumbersOutlined from '@mui/icons-material/NumbersOutlined';
import PaletteOutlined from '@mui/icons-material/PaletteOutlined';
import PercentOutlined from '@mui/icons-material/PercentOutlined';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import RadioButtonCheckedOutlined from '@mui/icons-material/RadioButtonCheckedOutlined';
import RepeatOutlined from '@mui/icons-material/RepeatOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SellOutlined from '@mui/icons-material/SellOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ShoppingBagOutlined from '@mui/icons-material/ShoppingBagOutlined';
import ShortTextOutlined from '@mui/icons-material/ShortTextOutlined';
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined';
import StarBorderOutlined from '@mui/icons-material/StarBorderOutlined';
import SubjectOutlined from '@mui/icons-material/SubjectOutlined';
import TextFieldsOutlined from '@mui/icons-material/TextFieldsOutlined';
import ToggleOnOutlined from '@mui/icons-material/ToggleOnOutlined';
import ViewAgendaOutlined from '@mui/icons-material/ViewAgendaOutlined';
import ViewColumnOutlined from '@mui/icons-material/ViewColumnOutlined';
import ViewCarouselOutlined from '@mui/icons-material/ViewCarouselOutlined';
import VerticalSplitOutlined from '@mui/icons-material/VerticalSplitOutlined';
import WebAssetOutlined from '@mui/icons-material/WebAssetOutlined';
import WebOutlined from '@mui/icons-material/WebOutlined';
import WidgetsOutlined from '@mui/icons-material/WidgetsOutlined';
import ArrowDropDownCircleOutlined from '@mui/icons-material/ArrowDropDownCircleOutlined';
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PersonOutlineOutlined from '@mui/icons-material/PersonOutlineOutlined';
import QuizOutlined from '@mui/icons-material/QuizOutlined';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';

type IconComponent = React.ComponentType<SvgIconProps>;

/**
 * One registry for every icon key stored in the content model (field types, blocks,
 * content types, projects), so a saved key always resolves — unknown keys fall back.
 */
const REGISTRY: Record<string, IconComponent> = {
  // Field types
  text: ShortTextOutlined,
  textarea: NotesOutlined,
  richtext: SubjectOutlined,
  markdown: TextFieldsOutlined,
  number: NumbersOutlined,
  decimal: PercentOutlined,
  boolean: ToggleOnOutlined,
  date: CalendarTodayOutlined,
  datetime: ScheduleOutlined,
  select: ArrowDropDownCircleOutlined,
  multiselect: ChecklistOutlined,
  radio: RadioButtonCheckedOutlined,
  checkbox: CheckBoxOutlined,
  email: AlternateEmailOutlined,
  url: LinkOutlined,
  phone: PhoneOutlined,
  password: LockOutlined,
  color: PaletteOutlined,
  json: DataObjectOutlined,
  code: CodeOutlined,
  image: ImageOutlined,
  images: PhotoLibraryOutlined,
  video: MovieOutlined,
  file: AttachFileOutlined,
  files: FolderCopyOutlined,
  relation: InsertLinkOutlined,
  relations: AccountTreeOutlined,
  component: ExtensionOutlined,
  repeatable: RepeatOutlined,
  dynamiczone: DynamicFeedOutlined,
  geolocation: LocationOnOutlined,
  slug: LabelOutlined,
  uid: FingerprintOutlined,
  rating: StarBorderOutlined,
  // Blocks
  section: ViewAgendaOutlined,
  columns: ViewColumnOutlined,
  hero: WebAssetOutlined,
  split: VerticalSplitOutlined,
  grid: GridViewOutlined,
  cards: WidgetsOutlined,
  quote: FormatQuoteOutlined,
  faq: QuizOutlined,
  pricing: SellOutlined,
  stats: BarChartOutlined,
  logos: ViewCarouselOutlined,
  gallery: CollectionsOutlined,
  cta: CallToActionOutlined,
  contact: ContactMailOutlined,
  team: GroupsOutlined,
  list: ListAltOutlined,
  products: ShoppingBagOutlined,
  breadcrumbs: NavigateNextOutlined,
  navigation: MenuOutlined,
  footer: WebOutlined,
  // Content types and projects
  document: DescriptionOutlined,
  article: ArticleOutlined,
  page: WebOutlined,
  layers: LayersOutlined,
  category: CategoryOutlined,
  tag: LocalOfferOutlined,
  person: PersonOutlineOutlined,
  people: GroupsOutlined,
  product: InventoryOutlined,
  shop: ShoppingBagOutlined,
  help: HelpOutlineOutlined,
  settings: SettingsOutlined,
  company: BusinessOutlined,
  bookmark: BookmarkBorderOutlined,
  bolt: BoltOutlined,
  key: KeyOutlined,
  dashboard: SpaceDashboardOutlined,
  flag: FlagOutlined,
  globe: PublicOutlined,
  event: EventOutlined,
  media: PhotoLibraryOutlined,
};

/** Icons offered when choosing an icon for a content type, component or project. */
export const SELECTABLE_ICONS = [
  'document', 'article', 'page', 'layers', 'category', 'tag', 'person', 'people', 'product', 'shop',
  'help', 'faq', 'quote', 'company', 'bookmark', 'bolt', 'flag', 'globe', 'event', 'media',
  'navigation', 'footer', 'settings', 'list', 'grid', 'cards', 'stats', 'pricing', 'contact', 'component',
];

export function IconFor({ name, ...props }: { name: string | null | undefined } & SvgIconProps) {
  const Icon = (name && REGISTRY[name]) || DescriptionOutlined;
  return <Icon {...props} />;
}

export const hasIcon = (name: string) => name in REGISTRY;
