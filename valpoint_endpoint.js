const State = {
    New: 0,
    Learning: 1,
    Review: 2,
    Relearning: 3,
};

const Rating = {
    Again: 1,
    Hard: 2,
    Good: 3,
    Easy: 4,
};

class ReviewLog {
    rating;
    elapsed_days;
    scheduled_days;
    review;
    state;
    constructor(rating, elapsed_days, scheduled_days, review, state) {
        this.rating = rating;
        this.elapsed_days = elapsed_days;
        this.scheduled_days = scheduled_days;
        this.review = review;
        this.state = state;
    }
}

class Card {
    due;
    stability;
    difficulty;
    elapsed_days;
    scheduled_days;
    reps;
    lapses;
    state;
    last_review;
    constructor() {
        this.due = new Date();
        this.stability = 0;
        this.difficulty = 0;
        this.elapsed_days = 0;
        this.scheduled_days = 0;
        this.reps = 0;
        this.lapses = 0;
        this.state = State.New;
        this.last_review = new Date();
    }
}

class SchedulingInfo {
    card;
    review_log;
    constructor(card, review_log) {
        this.card = card;
        this.review_log = review_log;
    }
}

class SchedulingCards {
    again;
    hard;
    good;
    easy;
    constructor(card) {
        this.again = { ...card };
        this.hard = { ...card };
        this.good = { ...card };
        this.easy = { ...card };
    }
    update_state(state) {
        if (state == State.New) {
            this.again.state = State.Learning;
            this.hard.state = State.Learning;
            this.good.state = State.Learning;
            this.easy.state = State.Review;
            this.again.lapses += 1;
        } else if (state == State.Learning || state == State.Relearning) {
            this.again.state = state;
            this.hard.state = state;
            this.good.state = State.Review;
            this.easy.state = State.Review;
        } else if (state == State.Review) {
            this.again.state = State.Relearning;
            this.hard.state = State.Review;
            this.good.state = State.Review;
            this.easy.state = State.Review;
            this.again.lapses += 1;
        }
    }
    schedule(now, hard_interval, good_interval, easy_interval) {
        this.again.scheduled_days = 0;
        this.hard.scheduled_days = hard_interval;
        this.good.scheduled_days = good_interval;
        this.easy.scheduled_days = easy_interval;

        this.again.due = new Date(now.getTime() + 5 * 60 * 1000);
        if (hard_interval > 0) {
            this.hard.due = new Date(now.getTime() + hard_interval * 24 * 60 * 60 * 1000);
        } else {
            this.hard.due = new Date(now.getTime() + 10 * 60 * 1000);
        }
        this.good.due = new Date(now.getTime() + good_interval * 24 * 60 * 60 * 1000);
        this.easy.due = new Date(now.getTime() + easy_interval * 24 * 60 * 60 * 1000);
    }

    record_log(card, now) {
        return {
            "Again": new SchedulingInfo(
                this.again,
                new ReviewLog("Again", this.again.scheduled_days, card.elapsed_days, now, card.state),
            ),
            "Hard": new SchedulingInfo(
                this.hard,
                new ReviewLog("Hard", this.hard.scheduled_days, card.elapsed_days, now, card.state),
            ),
            "Good": new SchedulingInfo(
                this.good,
                new ReviewLog("Good", this.good.scheduled_days, card.elapsed_days, now, card.state),
            ),
            "Easy": new SchedulingInfo(
                this.easy,
                new ReviewLog("Easy", this.easy.scheduled_days, card.elapsed_days, now, card.state),
            ),
        };
    }
}

class Params {
    request_retention;
    maximum_interval;
    w;
    constructor() {
        this.request_retention = 0.9;
        this.maximum_interval = 36500;
        this.w = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];
    }
}

class FSRS {
    p;
    constructor() {
        this.p = new Params();
    }
    repeat(card, now) {
        card = { ...card };
        if (card.state === State.New) {
            card.elapsed_days = 0;
        } else {
            card.elapsed_days = (now.getTime() - card.last_review.getTime()) / 86400000;
        }
        card.last_review = now;
        card.reps += 1;
        let s = new SchedulingCards(card);
        s.update_state(card.state);
        if (card.state === State.New) {
            this.init_ds(s);
            s.again.due = new Date(now.getTime() + 60 * 1000);
            s.hard.due = new Date(now.getTime() + 5 * 60 * 1000);
            s.good.due = new Date(now.getTime() + 10 * 60 * 1000);
            let easy_interval = this.next_interval(s.easy.stability);
            s.easy.scheduled_days = easy_interval;
            s.easy.due = new Date(
                now.getTime() + easy_interval * 24 * 60 * 60 * 1000,
            );
        } else if (
            card.state === State.Learning
            || card.state === State.Relearning
        ) {
            let hard_interval = 0;
            let good_interval = this.next_interval(s.good.stability);
            let easy_interval = Math.max(
                this.next_interval(s.easy.stability),
                good_interval + 1,
            );
            s.schedule(now, hard_interval, good_interval, easy_interval);
        } else if (card.state === State.Review) {
            let interval = card.elapsed_days;
            let last_d = card.difficulty;
            let last_s = card.stability;
            let retrievability = Math.pow(1 + interval / (9 * last_s), -1);
            this.next_ds(s, last_d, last_s, retrievability);
            let hard_interval = this.next_interval(s.hard.stability);
            let good_interval = this.next_interval(s.good.stability);
            hard_interval = Math.min(hard_interval, good_interval);
            good_interval = Math.max(good_interval, hard_interval + 1);
            let easy_interval = Math.max(
                this.next_interval(s.easy.stability),
                good_interval + 1,
            );
            s.schedule(now, hard_interval, good_interval, easy_interval);
        }
        const recordLogResult = s.record_log(card, now);
        return recordLogResult;
    }

    init_ds(s) {
        s.again.difficulty = this.init_difficulty(Rating.Again);
        s.again.stability = this.init_stability(Rating.Again);
        s.hard.difficulty = this.init_difficulty(Rating.Hard);
        s.hard.stability = this.init_stability(Rating.Hard);
        s.good.difficulty = this.init_difficulty(Rating.Good);
        s.good.stability = this.init_stability(Rating.Good);
        s.easy.difficulty = this.init_difficulty(Rating.Easy);
        s.easy.stability = this.init_stability(Rating.Easy);
    }

    next_ds(s, last_d, last_s, retrievability) {
        s.again.difficulty = this.next_difficulty(last_d, Rating.Again);
        s.again.stability = this.next_forget_stability(
            s.again.difficulty,
            last_s,
            retrievability,
        );
        s.hard.difficulty = this.next_difficulty(last_d, Rating.Hard);
        s.hard.stability = this.next_recall_stability(
            s.hard.difficulty,
            last_s,
            retrievability,
            Rating.Hard,
        );
        s.good.difficulty = this.next_difficulty(last_d, Rating.Good);
        s.good.stability = this.next_recall_stability(
            s.good.difficulty,
            last_s,
            retrievability,
            Rating.Good,
        );
        s.easy.difficulty = this.next_difficulty(last_d, Rating.Easy);
        s.easy.stability = this.next_recall_stability(
            s.easy.difficulty,
            last_s,
            retrievability,
            Rating.Easy,
        );
    }

    init_stability(r) {
        return Math.max(this.p.w[r - 1], 0.1);
    }

    init_difficulty(r) {
        return Math.min(Math.max(this.p.w[4] - this.p.w[5] * (r - 3), 1), 10);
    }

    next_interval(s) {
        let interval = s * 9 * (1 / this.p.request_retention - 1);
        return Math.min(Math.max(Math.round(interval), 1), this.p.maximum_interval);
    }

    next_difficulty(d, r) {
        let next_d = d - this.p.w[6] * (r - 3);
        return Math.min(Math.max(this.mean_reversion(this.p.w[4], next_d), 1), 10);
    }

    mean_reversion(init, current) {
        return this.p.w[7] * init + (1 - this.p.w[7]) * current;
    }

    next_recall_stability(d, s, r, rating) {
        let hard_penalty = rating === Rating.Hard ? this.p.w[15] : 1;
        let easy_bonus = rating === Rating.Easy ? this.p.w[16] : 1;
        return (
            s
            * (1
                + Math.exp(this.p.w[8])
                * (11 - d)
                * Math.pow(s, -this.p.w[9])
                * (Math.exp((1 - r) * this.p.w[10]) - 1)
                * hard_penalty
                * easy_bonus)
        );
    }

    next_forget_stability(d, s, r) {
        return (
            this.p.w[11]
            * Math.pow(d, -this.p.w[12])
            * (Math.pow(s + 1, this.p.w[13]) - 1)
            * Math.exp((1 - r) * this.p.w[14])
        );
    }
}

function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getRatingKey(grade) {
    const ratingKeys = ['Again', 'Hard', 'Good', 'Easy']; // Array of keys in the Rating object
    return ratingKeys[grade - 1]; // Subtract 1 because array indices start at 0
}

// FSRS API Handler
export async function fsrsEndpoint(req) {

    //difficulty = 0, stability = 0, state = 0, reps = 0, lapses = 0, scheduled_days = 0, elapsed_days = 0;
    //let lastReview = null;

    if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    // PARSE REQUEST
    const url = new URL(req.url);
    const srs = url.searchParams.get("srs");
    const grade = parseInt(url.searchParams.get("grade"));
    if (isNaN(grade) || grade < 1 || grade > 4) {
        return new Response("Bad Request: Invalid grade", { status: 400 });
    }

    // EXTRACT REQUIRED DATA 
    // --- srsValues format: difficulty/stability/state/reps/lapses
    let difficulty = 0, stability = 0, state = 0, reps = 0, lapses = 0, scheduled_days = 0, elapsed_days = 0;
    let lastReview = null;

    if (srs && srs !== "") {
        const match = srs.match(/\[\[date:(.+?)\]\] (.+)/);
        if (match) {
          // Use the matched values directly without declaring new variables
          lastReview = match[1];
          const srsValues = match[2];
          [stability, difficulty, state, reps, lapses, elapsed_days, scheduled_days] = srsValues.split("/").map(parseFloat);
        } else {
          // Handle the case where the format does not match
          return new Response("Bad Request: Invalid SRS format", { status: 400 });
        }
    }

    // VALIDATE INPUTS
    if (isNaN(grade) || grade < 1 || grade > 4) {
        return new Response("Bad Request: Invalid grade", { status: 400 });
    }
    if (!lastReview || isNaN(new Date(lastReview).getTime())) {
        lastReview = new Date().toISOString(); //Not reviewed before, so taking present date as last review.
        elapsed_days = 0;
        scheduled_days = 0;
    }
    if (isNaN(difficulty) || difficulty < 1 || difficulty > 10) {
        difficulty = 4.93; //Not defined until the first review. Hence set to an average difficulty level initially, which is the default w4 parameter - 4.93 representing "Good" rating.
    }
    if (isNaN(stability) || stability < 0) {
        stability = 0; //Not defined until the first review. Hence set to 0 initially.
    }
    if (!Object.values(State).includes(state)) {
        state = State.New; //This represents a card that has not been reviewed before.
    }
    if (isNaN(reps) || reps < 0) {
        reps = 0; //Card has not been reviewed before, so set default at zero.
    }
    if (isNaN(lapses) || lapses < 0) {
        lapses = 0; //Card has not been forgotten yet
    }

    // let interval = 86400000;  // 1 DAY- FIND OUT THE EQUIVALENT OF INTERVAL IN FSRS [ ]

    // CREATE NEW CARD OBJECT
    const card = new Card();
    card.last_review = new Date(lastReview);
    card.difficulty = difficulty;
    card.stability = stability;
    card.state = state;
    card.reps = reps;
    card.lapses = lapses;

    //SET UP ALGORITHM
    const fsrs = new FSRS();
    const now = new Date(); // Get today's date
    const ratingKey = getRatingKey(grade);

    const schedulingInfo = fsrs.repeat(card, now)[ratingKey];
    
    if (!schedulingInfo) {
        console.error("fsrs.repeat returned undefined. Card:", card, "Now:", now);
        // Return an error response or implement a fallback mechanism
        return new Response("Error: Unable to process scheduling information", { status: 500 });
    }

    const dueDate = schedulingInfo.card.due;
    const formattedDueDate = formatDate(dueDate);
    
    stability = parseFloat(schedulingInfo.card.stability.toFixed(3));
    difficulty = parseFloat(schedulingInfo.card.difficulty.toFixed(3));
    state = parseFloat(schedulingInfo.card.state.toFixed(3));
    reps = parseFloat(schedulingInfo.card.reps.toFixed(3));
    lapses = parseFloat(schedulingInfo.card.lapses.toFixed(3));
    elapsed_days = parseFloat(schedulingInfo.card.elapsed_days.toFixed(3));
    scheduled_days = parseFloat(schedulingInfo.card.scheduled_days.toFixed(3));

    const responseString = `[[date:${formattedDueDate}]] ${stability}/${difficulty}/${state}/${reps}/${lapses}/${elapsed_days}/${scheduled_days}`
    return new Response(responseString);
}
