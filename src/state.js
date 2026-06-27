/**
 * Centralised application state.
 *
 * All state mutations go through `setState()`.
 * Components subscribe with `subscribe(fn)` to react to changes.
 */

/** @type {AppState} */
let state = {
  /** @type {Photo[]} */
  photos: [],
  /** @type {Cluster[]} */
  clusters: [],
  /**
   * Route waypoints (lat/lon pairs) including user-added intermediate points.
   * Cluster centres are always included; extras are between clusters.
   * @type {{lat:number, lon:number, clusterId?:string}[]}
   */
  routeWaypoints: [],
  tripTitle: 'My Travel Diary',
  /** Whether the route is in edit mode */
  editMode: false,
  /** ID of the cluster whose popup is open, or null */
  activeClusterId: null,
  /** ID of photo being edited in the meta editor, or null */
  editingPhotoId: null,
  /** Waiting for user to click map to assign location to this photo ID */
  pendingLocationPhotoId: null,
};

const subscribers = new Set();

export function getState() {
  return state;
}

/**
 * Merge `updates` into the state and notify all subscribers.
 * @param {Partial<AppState>} updates
 */
export function setState(updates) {
  state = { ...state, ...updates };
  subscribers.forEach(fn => fn(state));
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
