#!/usr/bin/env python3
"""
Python script to verify Google Play purchases using WIF
Called by Node.js backend as a subprocess
"""
import sys
import os
import json
from google.auth import aws
from google.auth.transport.requests import Request
import requests

def _get_credentials():
    """Get authenticated Google credentials using WIF"""
    WORKLOAD_POOL_PROVIDER = os.environ.get("GOOGLE_WIF_PROVIDER",
        "projects/483343108270/locations/global/workloadIdentityPools/deenai-aws-pool/providers/deenai-aws-provider")
    SERVICE_ACCOUNT_EMAIL = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL",
        "app-distribution@deen-ai-481006.iam.gserviceaccount.com")
    SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]

    # Get AWS region
    token_response = requests.put(
        'http://169.254.169.254/latest/api/token',
        headers={'X-aws-ec2-metadata-token-ttl-seconds': '21600'},
        timeout=2
    )
    token = token_response.text
    region = requests.get(
        'http://169.254.169.254/latest/meta-data/placement/region',
        headers={'X-aws-ec2-metadata-token': token},
        timeout=2
    ).text.strip()

    # Set AWS region
    os.environ['AWS_REGION'] = region
    os.environ['AWS_DEFAULT_REGION'] = region

    # Build WIF credential configuration
    audience = f"//iam.googleapis.com/{WORKLOAD_POOL_PROVIDER}"
    credential_config = {
        "type": "external_account",
        "audience": audience,
        "subject_token_type": "urn:ietf:params:aws:token-type:aws4_request",
        "token_url": "https://sts.googleapis.com/v1/token",
        "service_account_impersonation_url": f"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{SERVICE_ACCOUNT_EMAIL}:generateAccessToken",
        "credential_source": {
            "environment_id": "aws1",
            "region_url": "http://169.254.169.254/latest/meta-data/placement/region",
            "url": "http://169.254.169.254/latest/meta-data/iam/security-credentials",
            "regional_cred_verification_url": "https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15",
            "imdsv2_session_token_url": "http://169.254.169.254/latest/api/token"
        }
    }

    # Create credentials
    credentials = aws.Credentials.from_info(credential_config)
    credentials = credentials.with_scopes(SCOPES)

    # Refresh credentials
    request = Request()
    credentials.refresh(request)
    return credentials


def verify_purchase(package_name, product_id, purchase_token):
    """Verify a Google Play purchase using WIF"""
    try:
        credentials = _get_credentials()

        # Try subscription first
        url = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package_name}/purchases/subscriptions/{product_id}/tokens/{purchase_token}"
        response = requests.get(
            url,
            headers={
                "Authorization": f"Bearer {credentials.token}",
                "Content-Type": "application/json"
            },
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "isSubscription": True,
                "data": data
            }
        elif response.status_code == 404:
            # Try one-time product instead
            url = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package_name}/purchases/products/{product_id}/tokens/{purchase_token}"
            response = requests.get(
                url,
                headers={
                    "Authorization": f"Bearer {credentials.token}",
                    "Content-Type": "application/json"
                },
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "isSubscription": False,
                    "data": data
                }
            else:
                return {
                    "success": False,
                    "error": f"Product verification failed with status {response.status_code}",
                    "statusCode": response.status_code,
                    "details": response.text
                }
        else:
            return {
                "success": False,
                "error": f"Subscription verification failed with status {response.status_code}",
                "statusCode": response.status_code,
                "details": response.text
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "errorType": type(e).__name__
        }

def acknowledge_subscription(package_name, product_id, purchase_token):
    """Acknowledge a Google Play subscription purchase using WIF"""
    try:
        credentials = _get_credentials()

        url = (
            f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"
            f"{package_name}/purchases/subscriptions/{product_id}/tokens/{purchase_token}:acknowledge"
        )
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {credentials.token}",
                "Content-Type": "application/json"
            },
            timeout=10
        )

        # 204 No Content = success, 200 also acceptable
        if response.status_code in (200, 204):
            return {"success": True}
        else:
            return {
                "success": False,
                "error": f"Acknowledge failed with status {response.status_code}",
                "statusCode": response.status_code,
                "details": response.text
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "errorType": type(e).__name__
        }


def acknowledge_product(package_name, product_id, purchase_token):
    """Acknowledge a Google Play one-time product purchase using WIF"""
    try:
        credentials = _get_credentials()

        url = (
            f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"
            f"{package_name}/purchases/products/{product_id}/tokens/{purchase_token}:acknowledge"
        )
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {credentials.token}",
                "Content-Type": "application/json"
            },
            timeout=10
        )

        if response.status_code in (200, 204):
            return {"success": True}
        else:
            return {
                "success": False,
                "error": f"Acknowledge failed with status {response.status_code}",
                "statusCode": response.status_code,
                "details": response.text
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "errorType": type(e).__name__
        }


def cancel_subscription(package_name, product_id, purchase_token):
    """Cancel a Google Play subscription using WIF"""
    try:
        credentials = _get_credentials()

        url = (
            f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"
            f"{package_name}/purchases/subscriptions/{product_id}/tokens/{purchase_token}:cancel"
        )
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {credentials.token}",
                "Content-Type": "application/json"
            },
            timeout=10
        )

        # 204 No Content = success, 200 also acceptable
        if response.status_code in (200, 204):
            return {"success": True}
        else:
            return {
                "success": False,
                "error": f"Cancel failed with status {response.status_code}",
                "statusCode": response.status_code,
                "details": response.text
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "errorType": type(e).__name__
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: verify_google_purchase.py <verify|cancel> <package_name> <product_id> <purchase_token>"
        }))
        sys.exit(1)

    action = sys.argv[1]

    if action == "verify":
        if len(sys.argv) != 5:
            print(json.dumps({
                "success": False,
                "error": "Usage: verify_google_purchase.py verify <package_name> <product_id> <purchase_token>"
            }))
            sys.exit(1)
        result = verify_purchase(sys.argv[2], sys.argv[3], sys.argv[4])
    elif action == "cancel":
        if len(sys.argv) != 5:
            print(json.dumps({
                "success": False,
                "error": "Usage: verify_google_purchase.py cancel <package_name> <product_id> <purchase_token>"
            }))
            sys.exit(1)
        result = cancel_subscription(sys.argv[2], sys.argv[3], sys.argv[4])
    elif action == "acknowledge":
        if len(sys.argv) != 6:
            print(json.dumps({
                "success": False,
                "error": "Usage: verify_google_purchase.py acknowledge <type> <package_name> <product_id> <purchase_token>"
            }))
            sys.exit(1)
        ack_type = sys.argv[2]  # "subscription" or "product"
        if ack_type == "subscription":
            result = acknowledge_subscription(sys.argv[3], sys.argv[4], sys.argv[5])
        elif ack_type == "product":
            result = acknowledge_product(sys.argv[3], sys.argv[4], sys.argv[5])
        else:
            print(json.dumps({
                "success": False,
                "error": f"Unknown acknowledge type: {ack_type}. Use 'subscription' or 'product'."
            }))
            sys.exit(1)
    else:
        # Backward compatibility: treat 3 positional args as verify
        if len(sys.argv) == 4:
            result = verify_purchase(sys.argv[1], sys.argv[2], sys.argv[3])
        else:
            print(json.dumps({
                "success": False,
                "error": f"Unknown action: {action}. Use 'verify' or 'cancel'."
            }))
            sys.exit(1)

    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)
