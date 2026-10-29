// Direct Play web dashboard.
//   store.js     state, REST client, master timeline values
//   data.js      polling, actions, archive/AI search, previews
//   dom.js       HTML rendering with in-place updates of live values
//   timeline.js  classic canvas timeline
//   actions.js   buttons, inputs, jog wheel and keyboard
//   views/       HTML for each part of the page
import {
  Archive, ChevronLeft, ChevronRight, CircleStop, Database, FolderPlus, Link2, Plus, Pause, Play, RefreshCw, Search,
  Settings2, Unlink, Volume2, VolumeX, Wifi, X, PanelsTopLeft, Sparkles, UserRound, ScanEye
} from 'lucide';
import { setView, render } from './dom.js';
import { buildAppHtml } from './views/shell.js';
import { bindEvents } from './actions.js';
import { refreshDashboard } from './data.js';
import { requestTimelinePaint } from './timeline.js';
import './styles.css';
import './workbench.css';
import './timeline.css';

setView({
  build: buildAppHtml,
  bind: bindEvents,
  afterRender: requestTimelinePaint,
  icons: {
    Archive, ChevronLeft, ChevronRight, CircleStop, Database, FolderPlus, Link2, Plus, Pause, Play, RefreshCw, Search,
    Settings2, Unlink, Volume2, VolumeX, Wifi, X, PanelsTopLeft, Sparkles, UserRound, ScanEye
  }
});

render();
refreshDashboard({ force: true });
