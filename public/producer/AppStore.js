class ObservableStore {
	constructor(initialState = {}) {
		this.state = initialState;
		this.listeners = new Set(); // Using a Set to store unique callback functions
		console.log('Store initialized with:', this.state);
	}

	/**
	 * Get a shallow copy of the current state.
	 * Returning a copy prevents direct external modification of the internal state.
	 */
	getState() {
		return { ...this.state };
	}

	/**
	 * Update the state. Merges new state with existing state.
	 * Notifies all subscribed listeners after updating.
	 * @param {object} newState - An object containing state properties to update.
	 */
	setState(newState) {
		// Simple shallow merge. For deep merges, consider a utility library.
		const prevState = this.getState();
		this.state = { ...prevState, ...newState };
		console.log('State updated to:', this.state);
		this.notifyListeners();
	}

	/**
	 * Subscribe a callback function to state changes.
	 * @param {function} callback - The function to call when state changes.
	 * @returns {function} An unsubscribe function to remove the listener.
	 */
	subscribe(callback) {
		this.listeners.add(callback);
		// Optionally, immediately call the callback with the current state upon subscription
		// This ensures components get the current state as soon as they subscribe.
		callback(this.getState());

		// Return an unsubscribe function
		return () => {
			this.listeners.delete(callback);
			console.log('Listener unsubscribed.');
		};
	}

	/**
	 * Internal method to notify all subscribed listeners about state changes.
	 */
	notifyListeners() {
		const currentState = this.getState();
		this.listeners.forEach(callback => {
			try {
				callback(currentState);
			} catch (error) {
				console.error('Error in store listener:', error);
				// Optionally remove faulty listener or log more details
			}
		});
	}
}

// Create a single, globally accessible instance of your store
// This is your application's central state manager
export const appStore = new ObservableStore({
	config: {},
});
