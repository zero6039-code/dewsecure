import os
import boto3
import gzip
from botocore.config import Config

def download_history():
    print("⏳ 正在从 R2 下载历史威胁情报...")
    s3 = boto3.client(
        's3',
        endpoint_url=os.environ.get('R2_ENDPOINT'),
        aws_access_key_id=os.environ.get('R2_ACCESS_KEY_ID'),
        aws_secret_access_key=os.environ.get('R2_SECRET_ACCESS_KEY'),
        config=Config(signature_version='s3v4')
    )
    
    bucket = os.environ.get('R2_BUCKET')
    # 假设你的恶意 URL 存在 phish-history/ 目录（如果没有，会抓取 intel/ 里的文件作为降级）
    urls = set()
    for prefix in ['phish-history/', 'intel/']:
        try:
            response = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    if key.endswith('.txt') or key.endswith('.txt.gz'):
                        print(f"下载: {key}")
                        data = s3.get_object(Bucket=bucket, Key=key)['Body'].read()
                        if key.endswith('.gz'):
                            data = gzip.decompress(data)
                        for line in data.decode('utf-8').splitlines():
                            if line.strip() and line.strip().startswith('http'):
                                urls.add(line.strip())
        except Exception as e:
            print(f"跳过 {prefix}: {e}")
            continue
    
    print(f"✅ 从 R2 提取到 {len(urls)} 条历史钓鱼 URL")
    return list(urls)

if __name__ == '__main__':
    urls = download_history()
    with open('/tmp/r2_phish_urls.txt', 'w') as f:
        f.write('\n'.join(urls))
