#!/usr/bin/env python3
"""
Python script to verify Google Play purchases using WIF
Called by Node.js backend as a subprocess
"""
import sys
import json
from google.auth import aws
from google.auth.transport.requests import Request
import requests

def verify_purchase(package_name, product_id, purchase_token):
    """Verify a Google Play purchase using WIF"""
    try:
        # WIF Configuration
        WORKLOAD_POOL_PROVIDER = "projects/483343108270/locations/global/workloadIdentityPools/deenai-aws-pool/providers/deenai-aws-provider"
        SERVICE_ACCOUNT_EMAIL = "app-distribution@deen-ai-481006.iam.gserviceaccount.com"
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
        import os
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

        # Try subscription first
        url = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package_name}/purchases/subscriptions/{product_id}/tokens/{purchase_token}"
        response = requests.get(
            url,
            headers={
                "Authorization": f"Bearer {credentials.token}",
                "Content-Type": "application/json"
            }
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
                }
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

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(json.dumps({
            "success": False,
            "error": "Usage: verify_google_purchase.py <package_name> <product_id> <purchase_token>"
        }))
        sys.exit(1)

    package_name = sys.argv[1]
    product_id = sys.argv[2]
    purchase_token = sys.argv[3]

    result = verify_purchase(package_name, product_id, purchase_token)
    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)
