/**
 * External dependencies
 */
import { debounce } from 'lodash';
import { select, dispatch } from '@wordpress/data';
import {
	pluckAddress,
	pluckEmail,
	removeAllNotices,
} from '@woocommerce/base-utils';
import {
	CartResponseBillingAddress,
	CartResponseShippingAddress,
} from '@woocommerce/type-defs/cart-response';
import isShallowEqual from '@wordpress/is-shallow-equal';
import { BillingAddressShippingAddress } from '@woocommerce/type-defs/cart';

/**
 * Internal dependencies
 */
import { STORE_KEY } from './constants';
import { VALIDATION_STORE_KEY } from '../validation';
import { processErrorResponse } from '../utils';

declare type CustomerData = {
	billingAddress: CartResponseBillingAddress;
	shippingAddress: CartResponseShippingAddress;
};

/**
 * Checks if a cart response contains an email property.
 */
const isCartResponseBillingAddress = (
	address: CartResponseBillingAddress | CartResponseShippingAddress
): address is CartResponseBillingAddress => {
	return 'email' in address;
};

/**
 * Does a shallow compare of important address data to determine if the cart needs updating on the server. This takes
 * the current and previous address into account, as well as the billing email field.
 */
const isAddressDirty = <
	T extends CartResponseBillingAddress | CartResponseShippingAddress
>(
	// An object containing all previous address information
	previousAddress: T,
	// An object containing all address information.
	address: T
): boolean => {
	if (
		isCartResponseBillingAddress( address ) &&
		pluckEmail( address ) !==
			pluckEmail( previousAddress as CartResponseBillingAddress )
	) {
		return true;
	}

	return (
		!! address.country &&
		! isShallowEqual(
			pluckAddress( previousAddress ),
			pluckAddress( address )
		)
	);
};

/**
 * Local cache of customerData used for comparisons.
 */
let customerData = <CustomerData>{
	billingAddress: {},
	shippingAddress: {},
};
// Tracks if customerData has been populated.
let customerDataIsInitialized = false;

/**
 * Tracks which props have changed so the correct data gets pushed to the server.
 */
const dirtyProps = {
	billingAddress: false,
	shippingAddress: false,
};

/**
 * Function to dispatch an update to the server. This is debounced.
 */
const updateCustomerData = debounce( (): void => {
	const { billingAddress, shippingAddress } = customerData;
	const customerDataToUpdate = {} as Partial< BillingAddressShippingAddress >;

	if ( dirtyProps.billingAddress ) {
		customerDataToUpdate.billing_address = billingAddress;
		dirtyProps.billingAddress = false;
	}

	if ( dirtyProps.shippingAddress ) {
		customerDataToUpdate.shipping_address = shippingAddress;
		dirtyProps.shippingAddress = false;
	}

	if ( Object.keys( customerDataToUpdate ).length ) {
		dispatch( STORE_KEY )
			.updateCustomerData( customerDataToUpdate )
			.then( () => {
				removeAllNotices();
			} )
			.catch( ( response ) => {
				processErrorResponse( response );
			} );
	}
}, 1000 );

/**
 * After cart has fully initialized, pushes changes to the server when data in the store is changed. Updates to the
 * server are debounced to prevent excessive requests.
 */
export const pushChanges = (): void => {
	const store = select( STORE_KEY );
	const hasValidationErrors =
		select( VALIDATION_STORE_KEY ).hasValidationErrors();
	const isInitialized = store.hasFinishedResolution( 'getCartData' );

	if ( ! isInitialized || hasValidationErrors ) {
		return;
	}

	const newCustomerData = store.getCustomerData();

	if ( ! customerDataIsInitialized ) {
		customerData = newCustomerData;
		customerDataIsInitialized = true;
		return;
	}

	// An address is dirty and needs pushing to the server if the email, country, state, city, or postcode have changed.
	if (
		isAddressDirty(
			customerData.billingAddress,
			newCustomerData.billingAddress
		)
	) {
		dirtyProps.billingAddress = true;
	}

	if (
		isAddressDirty(
			customerData.shippingAddress,
			newCustomerData.shippingAddress
		)
	) {
		dirtyProps.shippingAddress = true;
	}

	customerData = newCustomerData;

	if ( dirtyProps.billingAddress || dirtyProps.shippingAddress ) {
		updateCustomerData();
	}
};
