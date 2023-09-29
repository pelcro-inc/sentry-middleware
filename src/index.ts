import { AWSLambda } from '@sentry/serverless';
import { type NodeOptions } from '@sentry/node';


export function sentryMiddleware(sentryOptions: NodeOptions, _optionalScopeCb?: CallableFunction) {

    function initSentry(request: any) {
        AWSLambda.init(sentryOptions)

        AWSLambda.configureScope((scope) => {
            scope.setExtra("data", request?.event?.data)
            scope.setTag("webhook_id", request?.event?.event_id)
            scope.setTag("type", request?.event?.webhook_type)
            scope.setTag(
                `${request?.event?.type?.split(".")[0]}_id`,
                request?.event?.data?.object?.id
            );
            
            if (_optionalScopeCb)
                _optionalScopeCb(scope)
        })
    }

    return {
        before: initSentry,
        // onError: sentryErrorHandler
    }
}

export const wrapper = AWSLambda.wrapHandler;