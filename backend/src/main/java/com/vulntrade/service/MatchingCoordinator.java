package com.vulntrade.service;

import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.persistence.EntityManager;
import javax.persistence.PersistenceContext;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Serialises everything that touches the order book: placing, cancelling, deleting orders and
 * the house market-maker pass.
 *
 * <p>One global, fair lock — not one per symbol. The house (user 1) is the counterparty on
 * almost every fill, so per-symbol locks would take user rows in opposite orders on different
 * symbols and deadlock in Postgres. The lock is taken <em>outside</em> the transaction, so the
 * commit and the after-commit broadcasts both happen before the next caller reads the book.
 *
 * <p>The backend therefore has to run as a single replica.
 */
@Component
public class MatchingCoordinator {

    private static final long LOCK_WAIT_SECONDS = 10;

    private final ReentrantLock lock = new ReentrantLock(true);
    private final TransactionTemplate transactionTemplate;

    @PersistenceContext
    private EntityManager entityManager;

    public MatchingCoordinator(PlatformTransactionManager transactionManager) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setTimeout(30);
    }

    /** Run {@code work} under the matching lock, in one transaction. Re-entrant. */
    public <T> T execute(Supplier<T> work) {
        if (lock.isHeldByCurrentThread()) {
            return work.get();   // nested call: already locked and inside the transaction
        }
        boolean acquired;
        try {
            acquired = lock.tryLock(LOCK_WAIT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Matching engine busy, please retry");
        }
        if (!acquired) {
            throw new RuntimeException("Matching engine busy, please retry");
        }
        try {
            return transactionTemplate.execute(status -> {
                // Open-session-in-view keeps entities read earlier in the request (e.g. by the
                // risk check) in the persistence context. Start from a clean slate so every
                // order, balance and position is read fresh under the lock.
                entityManager.flush();
                entityManager.clear();
                return work.get();
            });
        } finally {
            lock.unlock();
        }
    }

    public void run(Runnable work) {
        execute(() -> {
            work.run();
            return null;
        });
    }
}
