import { type NodeOptions } from '@sentry/node';
import {init, configureScope, captureException} from '@sentry/node';


export default function sentryHandler(sentryOptions: NodeOptions, optionalScopeCb?: CallableFunction) {

    init(sentryOptions)

    const sentryErrorHandler = (request: any) => {
        console.info("Error Request : ",JSON.stringify(request))

            configureScope((scope) => {
                if (optionalScopeCb) optionalScopeCb(scope);
            });

            captureException(request.error);
    }

    return {
        onError: sentryErrorHandler
    }
}