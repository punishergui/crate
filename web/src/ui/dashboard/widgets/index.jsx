import { concertsWidget } from './concerts';
import { newReleasesWidget } from './newReleases';
import { libraryWidget } from './library';
import { downloadsWidget } from './downloads';
import { discoverWidget } from './discover';
import { missingAlbumsWidget } from './missingAlbums';
import { upcomingReleasesWidget } from './upcomingReleases';
import { recentActivityWidget } from './recentActivity';

export const widgetRegistry = [
  concertsWidget,
  newReleasesWidget,
  libraryWidget,
  downloadsWidget,
  discoverWidget,
  missingAlbumsWidget,
  upcomingReleasesWidget,
  recentActivityWidget
].map((widget, index) => ({
  ...widget,
  defaultOrder: Number.isInteger(widget.defaultOrder) ? widget.defaultOrder : index,
  defaultVisible: widget.defaultVisible !== false
}));

export const widgetMap = Object.fromEntries(widgetRegistry.map((widget) => [widget.id, widget]));
