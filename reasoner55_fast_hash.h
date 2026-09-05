#ifndef R55FAST_HASH_H
#define R55FAST_HASH_H

#if R55FAST_HASH
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#define R55FAST_HASH_BACKEND "CommonCrypto SHA-256"
#else
#include <openssl/evp.h>
#include <openssl/crypto.h>
#define R55FAST_HASH_BACKEND "OpenSSL EVP SHA-256"
#endif

typedef struct {
#ifdef __APPLE__
    CC_SHA256_CTX context;
#else
    EVP_MD_CTX *context;
#endif
    uint8_t pending[4096];
    size_t used;
} r55_sha256;

static void r55fast_hash_require(int success)
{
    if (success != 1) {
        fputs("system SHA-256 failed\n", stderr);
        abort();
    }
}

static void r55_sha256_init(r55_sha256 *sha)
{
    sha->used = 0;
#ifdef __APPLE__
    r55fast_hash_require(CC_SHA256_Init(&sha->context));
#else
    sha->context = EVP_MD_CTX_new();
    if (!sha->context) r55fast_hash_require(0);
    r55fast_hash_require(EVP_DigestInit_ex(sha->context, EVP_sha256(), NULL));
#endif
}

static void r55fast_hash_write(r55_sha256 *sha, const uint8_t *bytes, size_t length)
{
#ifdef __APPLE__
    while (length) {
        CC_LONG chunk = length > UINT32_MAX ? UINT32_MAX : (CC_LONG)length;
        r55fast_hash_require(CC_SHA256_Update(&sha->context, bytes, chunk));
        bytes += chunk;
        length -= chunk;
    }
#else
    if (length) r55fast_hash_require(EVP_DigestUpdate(sha->context, bytes, length));
#endif
}

static void r55_sha256_update(r55_sha256 *sha, const void *data, size_t length)
{
    const uint8_t *bytes = data;
    if (!length) return;
    if (sha->used) {
        size_t room = sizeof(sha->pending) - sha->used;
        size_t take = length < room ? length : room;
        memcpy(sha->pending + sha->used, bytes, take);
        sha->used += take;
        bytes += take;
        length -= take;
        if (sha->used == sizeof(sha->pending)) {
            r55fast_hash_write(sha, sha->pending, sha->used);
            sha->used = 0;
        }
    }
    if (length >= sizeof(sha->pending)) {
        r55fast_hash_write(sha, bytes, length);
    } else if (length) {
        memcpy(sha->pending, bytes, length);
        sha->used = length;
    }
}

static void r55_sha256_final(r55_sha256 *sha, uint8_t digest[32])
{
    r55fast_hash_write(sha, sha->pending, sha->used);
#ifdef __APPLE__
    r55fast_hash_require(CC_SHA256_Final(digest, &sha->context));
#else
    unsigned int length = 0;
    int success = EVP_DigestFinal_ex(sha->context, digest, &length);
    EVP_MD_CTX_free(sha->context);
    sha->context = NULL;
    r55fast_hash_require(success == 1 && length == 32);
#endif
    sha->used = 0;
}
#else
#define R55FAST_HASH_BACKEND "original portable SHA-256"
typedef r55_ref_sha256 r55_sha256;
#define r55_sha256_init r55_ref_sha256_init
#define r55_sha256_update r55_ref_sha256_update
#define r55_sha256_final r55_ref_sha256_final
#endif
#endif
